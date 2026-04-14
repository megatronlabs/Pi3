import type { Provider, Message } from '@swarm/providers'
import type { AgentTool } from './AgentTool.js'
import { QueryEngine } from './QueryEngine.js'
import type { TurnEvent } from './QueryEngine.js'
import type { MessageBus, AgentMessage } from '@swarm/bus'
import { formatMessageForContext } from '@swarm/bus'

export interface AgentConfig {
  id: string
  name: string
  provider: Provider
  model: string
  tools?: AgentTool[]
  systemPrompt?: string
  workingDir?: string
  /** Message bus for inter-agent communication. When provided the agent
   *  subscribes to messages addressed to its id and queues them for injection
   *  at the start of the next turn. */
  bus?: MessageBus
  /** Session ID — attached to every outgoing message for tracing */
  sessionId?: string
}

export type AgentStatus = 'idle' | 'running' | 'done' | 'error'

export class Agent {
  readonly id: string
  readonly name: string
  readonly model: string
  readonly providerId: string
  readonly sessionId: string
  status: AgentStatus

  private engine: QueryEngine
  private _pendingMessages: AgentMessage[] = []
  private _unsubscribeBus?: () => void

  constructor(config: AgentConfig) {
    this.id = config.id
    this.name = config.name
    this.model = config.model
    this.providerId = config.provider.id
    this.sessionId = config.sessionId ?? `session-${Date.now()}`
    this.status = 'idle'

    this.engine = new QueryEngine({
      provider: config.provider,
      model: config.model,
      tools: config.tools,
      systemPrompt: config.systemPrompt,
      workingDir: config.workingDir,
    })

    if (config.bus) {
      this._unsubscribeBus = config.bus.subscribe(config.id, msg => {
        this._pendingMessages.push(msg)
      })
    }
  }

  // -------------------------------------------------------------------------
  // Running
  // -------------------------------------------------------------------------

  async *run(prompt: string): AsyncIterable<TurnEvent> {
    this.status = 'running'
    try {
      // Drain any queued inter-agent messages and prepend to prompt
      const pending = this._pendingMessages.splice(0)
      let fullPrompt = prompt

      if (pending.length > 0) {
        const injected = pending
          .map(msg => formatMessageForContext(msg))
          .join('\n\n')
        fullPrompt =
          `[Incoming agent messages — respond to these before or alongside the task below]\n\n` +
          `${injected}\n\n` +
          `---\n\n` +
          prompt
      }

      for await (const event of this.engine.turn(fullPrompt)) {
        yield event
        if (event.type === 'error') {
          this.status = 'error'
        }
      }
      if (this.status === 'running') {
        this.status = 'done'
      }
    } catch (err) {
      this.status = 'error'
      const message = err instanceof Error ? err.message : String(err)
      yield { type: 'error', message }
    }
  }

  // -------------------------------------------------------------------------
  // Incoming message injection
  // -------------------------------------------------------------------------

  /**
   * Directly inject a message into this agent's queue.
   * It will be prepended to the next run() call's prompt.
   */
  injectMessage(msg: AgentMessage): void {
    this._pendingMessages.push(msg)
  }

  /** True if there are messages waiting to be processed */
  get hasPendingMessages(): boolean {
    return this._pendingMessages.length > 0
  }

  // -------------------------------------------------------------------------
  // History / lifecycle
  // -------------------------------------------------------------------------

  getHistory(): Message[] {
    return this.engine.getHistory()
  }

  reset(): void {
    this.engine.reset()
    this.status = 'idle'
    this._pendingMessages = []
  }

  compact(keepLast = 20): void {
    this.engine.compact(keepLast)
  }

  /** Unsubscribe from the bus (call on agent teardown) */
  dispose(): void {
    this._unsubscribeBus?.()
  }
}
