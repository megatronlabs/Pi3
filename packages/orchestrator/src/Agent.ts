import type { Provider, Message } from '@swarm/providers'
import type { AgentTool } from './AgentTool.js'
import { QueryEngine } from './QueryEngine.js'
import type { TurnEvent } from './QueryEngine.js'

export interface AgentConfig {
  id: string
  name: string
  provider: Provider
  model: string
  tools?: AgentTool[]
  systemPrompt?: string
  workingDir?: string
}

export type AgentStatus = 'idle' | 'running' | 'done' | 'error'

export class Agent {
  readonly id: string
  readonly name: string
  readonly model: string
  readonly providerId: string
  status: AgentStatus
  private engine: QueryEngine

  constructor(config: AgentConfig) {
    this.id = config.id
    this.name = config.name
    this.model = config.model
    this.providerId = config.provider.id
    this.status = 'idle'

    this.engine = new QueryEngine({
      provider: config.provider,
      model: config.model,
      tools: config.tools,
      systemPrompt: config.systemPrompt,
      workingDir: config.workingDir,
    })
  }

  async *run(prompt: string): AsyncIterable<TurnEvent> {
    this.status = 'running'
    try {
      for await (const event of this.engine.turn(prompt)) {
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

  getHistory(): Message[] {
    return this.engine.getHistory()
  }

  reset(): void {
    this.engine.reset()
    this.status = 'idle'
  }

  compact(keepLast = 20): void {
    this.engine.compact(keepLast)
  }
}
