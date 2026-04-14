import { EventEmitter } from 'events'
import type { AgentMessage } from './types.js'

const LOG_MAX = 1000

interface PendingBanter {
  resolve: (msg: AgentMessage) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
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
 */
export class MessageBus extends EventEmitter {
  private _log: AgentMessage[] = []
  // agentId → set of handler functions
  private _subscribers: Map<string, Set<(msg: AgentMessage) => void>> = new Map()
  // original query message id → pending banter state
  private _pendingBanter: Map<string, PendingBanter> = new Map()

  // -------------------------------------------------------------------------
  // Publishing
  // -------------------------------------------------------------------------

  publish(msg: AgentMessage): void {
    // Append to rolling log
    this._log.push(msg)
    if (this._log.length > LOG_MAX) this._log.shift()

    // Route to target subscriber(s)
    this._route(msg)

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
  // Private routing
  // -------------------------------------------------------------------------

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
