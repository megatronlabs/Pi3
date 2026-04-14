import { EventEmitter } from 'events'
import { promises as fs } from 'fs'
import { join, dirname } from 'path'
import type { AgentMessage } from './types.js'

const LOG_MAX = 1000

interface PendingBanter {
  resolve: (msg: AgentMessage) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export interface MessageBusOptions {
  /** Directory for per-agent inbox persistence. Omit to disable. */
  inboxDir?: string
  /** Max messages allowed per session. Exceeding this throws BusCapacityError. */
  maxMessages?: number
}

export class BusCapacityError extends Error {
  constructor(limit: number) {
    super(`MessageBus capacity reached: session limit of ${limit} messages exceeded`)
    this.name = 'BusCapacityError'
  }
}

/**
 * MessageBus — in-process pub/sub backbone for inter-agent communication.
 *
 * Supports two delivery patterns:
 *
 *   fire-and-forget  publish(msg)              → routed immediately, no reply expected
 *   banter           banter(msg, timeoutMs)    → awaits a reply message with matching
 *                                                correlationId; rejects on timeout
 *
 * Routing:
 *   msg.to = '<agentId>'  → delivered to that agent's subscriber(s)
 *   msg.to = 'all'        → delivered to every subscriber (broadcast)
 *
 * All messages pass through a rolling log (last LOG_MAX entries) readable by the TUI.
 * A monitor() hook delivers every message for telemetry/logging use.
 *
 * Optional features (via MessageBusOptions):
 *   maxMessages — throws BusCapacityError when session message count is exceeded
 *   inboxDir    — atomically persists each message to ~/.swarm/inbox/<agentId>/<ts>-<id>.json
 */
export class MessageBus extends EventEmitter {
  private _log: AgentMessage[] = []
  // agentId → set of handler functions
  private _subscribers: Map<string, Set<(msg: AgentMessage) => void>> = new Map()
  // original query message id → pending banter state
  private _pendingBanter: Map<string, PendingBanter> = new Map()
  private _messageCount = 0
  private _opts: MessageBusOptions

  constructor(opts: MessageBusOptions = {}) {
    super()
    this._opts = opts
  }

  // -------------------------------------------------------------------------
  // Publishing
  // -------------------------------------------------------------------------

  publish(msg: AgentMessage): void {
    if (this._opts.maxMessages !== undefined && this._messageCount >= this._opts.maxMessages) {
      throw new BusCapacityError(this._opts.maxMessages)
    }
    this._messageCount++

    // Append to rolling log
    this._log.push(msg)
    if (this._log.length > LOG_MAX) this._log.shift()

    // Route to target subscriber(s)
    this._route(msg)

    // Persist to inbox (fire-and-forget)
    this._persistToInbox(msg)

    // Notify monitors (telemetry)
    this.emit('message', msg)

    // Resolve any pending banter waiting on this reply
    if (msg.type === 'reply' && msg.correlationId) {
      const pending = this._pendingBanter.get(msg.correlationId)
      if (pending) {
        clearTimeout(pending.timer)
        this._pendingBanter.delete(msg.correlationId)
        pending.resolve(msg)
      }
    }
  }

  /**
   * Banter — publish a query and await a matching reply.
   *
   * The returned promise resolves when another agent publishes a message with
   * type='reply' and correlationId equal to this message's id. Rejects if no
   * reply arrives within timeoutMs.
   */
  async banter(msg: AgentMessage, timeoutMs = 30_000): Promise<AgentMessage> {
    if (this._opts.maxMessages !== undefined && this._messageCount >= this._opts.maxMessages) {
      throw new BusCapacityError(this._opts.maxMessages)
    }
    this._messageCount++

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingBanter.delete(msg.id)
        reject(new Error(`Banter timeout: no reply from "${msg.to}" within ${timeoutMs}ms`))
      }, timeoutMs)

      this._pendingBanter.set(msg.id, { resolve, reject, timer })

      // publish without triggering banter resolution (type is 'query', not 'reply')
      this._log.push(msg)
      if (this._log.length > LOG_MAX) this._log.shift()
      this._route(msg)
      this._persistToInbox(msg)
      this.emit('message', msg)
    })
  }

  // -------------------------------------------------------------------------
  // Subscriptions
  // -------------------------------------------------------------------------

  /**
   * Subscribe to messages addressed to agentId (or 'all' broadcasts).
   * Returns an unsubscribe function.
   */
  subscribe(agentId: string, handler: (msg: AgentMessage) => void): () => void {
    if (!this._subscribers.has(agentId)) {
      this._subscribers.set(agentId, new Set())
    }
    this._subscribers.get(agentId)!.add(handler)
    return () => {
      this._subscribers.get(agentId)?.delete(handler)
    }
  }

  /**
   * Monitor every message that flows through the bus (for telemetry/logging).
   * Returns an unsubscribe function.
   */
  monitor(handler: (msg: AgentMessage) => void): () => void {
    this.on('message', handler)
    return () => this.off('message', handler)
  }

  // -------------------------------------------------------------------------
  // Log access (for CommLog TUI panel)
  // -------------------------------------------------------------------------

  getLog(limit = 200): AgentMessage[] {
    return this._log.slice(-limit)
  }

  clearLog(): void {
    this._log = []
  }

  // -------------------------------------------------------------------------
  // Inbox persistence
  // -------------------------------------------------------------------------

  /**
   * Read all persisted messages for an agent, sorted chronologically.
   * Returns [] if inboxDir is not configured or the directory doesn't exist.
   */
  async readInbox(agentId: string): Promise<AgentMessage[]> {
    const { inboxDir } = this._opts
    if (!inboxDir) return []
    const dir = join(inboxDir, agentId)
    try {
      const files = (await fs.readdir(dir))
        .filter(f => f.endsWith('.json'))
        .sort()
      const messages: AgentMessage[] = []
      for (const file of files) {
        try {
          const raw = await fs.readFile(join(dir, file), 'utf8')
          const parsed = JSON.parse(raw)
          parsed.timestamp = new Date(parsed.timestamp)
          messages.push(parsed as AgentMessage)
        } catch {
          // skip corrupt files
        }
      }
      return messages
    } catch {
      return []
    }
  }

  /** Delete all persisted inbox messages for an agent. */
  async clearInbox(agentId: string): Promise<void> {
    const { inboxDir } = this._opts
    if (!inboxDir) return
    const dir = join(inboxDir, agentId)
    try {
      const files = await fs.readdir(dir)
      await Promise.all(files.map(f => fs.unlink(join(dir, f)).catch(() => {})))
    } catch {
      // directory doesn't exist — nothing to clear
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Atomically write msg to disk under inboxDir.
   * For broadcast (msg.to='all'), writes to every subscribed agent's dir.
   * Never throws — all errors are swallowed (fire-and-forget).
   */
  private _persistToInbox(msg: AgentMessage): void {
    const { inboxDir } = this._opts
    if (!inboxDir) return

    const targets: string[] =
      msg.to === 'all' ? [...this._subscribers.keys()] : [msg.to]

    const filename = `${Date.now()}-${msg.id}.json`
    const data = JSON.stringify(msg, null, 2)

    for (const agentId of targets) {
      const dir = join(inboxDir, agentId)
      const tmpPath = join(dir, `${filename}.tmp`)
      const finalPath = join(dir, filename)
      ;(async () => {
        try {
          await fs.mkdir(dir, { recursive: true })
          await fs.writeFile(tmpPath, data, 'utf8')
          await fs.rename(tmpPath, finalPath)
        } catch {
          // fire-and-forget: never throws
        }
      })()
    }
  }

  private _route(msg: AgentMessage): void {
    if (msg.to === 'all') {
      for (const handlers of this._subscribers.values()) {
        for (const fn of handlers) fn(msg)
      }
    } else {
      const handlers = this._subscribers.get(msg.to)
      if (handlers) {
        for (const fn of handlers) fn(msg)
      }
    }
  }
}
