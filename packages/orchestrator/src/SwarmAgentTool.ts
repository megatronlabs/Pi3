import { z } from 'zod'
import type { AgentTool } from './AgentTool.js'
import { Agent } from './Agent.js'
import { SendAgentMessageTool } from './SendAgentMessageTool.js'
import type { Provider } from '@swarm/providers'
import type { MessageBus, CommunicationLanguage } from '@swarm/bus'

const SwarmAgentInputSchema = z.object({
  task: z.string().describe('The task for the sub-agent to complete'),
  model: z.string().optional().describe('Model to use (defaults to same as parent)'),
  provider: z.string().optional().describe('Provider to use (defaults to same as parent)'),
  systemPrompt: z.string().optional().describe('Optional system prompt for the sub-agent'),
})

export type SwarmAgentInput = z.infer<typeof SwarmAgentInputSchema>

export class SwarmAgentTool implements AgentTool<SwarmAgentInput, string> {
  name = 'spawn_agent'
  description =
    'Spawn a sub-agent to complete a specific task. Use this to delegate work to a helper agent. The sub-agent runs independently and returns its result.'
  inputSchema = SwarmAgentInputSchema

  constructor(
    private options: {
      defaultProvider: Provider
      defaultModel: string
      tools?: AgentTool[]
      workingDir?: string
      providerRegistry?: Map<string, Provider>
      bus?: MessageBus
      sessionId?: string
      language?: CommunicationLanguage
    },
  ) {}

  async call(input: SwarmAgentInput, ctx: { workingDir: string }): Promise<string> {
    // Resolve provider
    let provider = this.options.defaultProvider
    if (input.provider && this.options.providerRegistry) {
      const resolved = this.options.providerRegistry.get(input.provider)
      if (resolved) {
        provider = resolved
      }
    }

    const model = input.model ?? this.options.defaultModel
    const workingDir = ctx.workingDir ?? this.options.workingDir ?? process.cwd()

    const agentId = `sub-agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    // Build tools list, adding SendAgentMessageTool when bus is present
    const subTools = [...(this.options.tools ?? [])]
    if (this.options.bus) {
      subTools.push(new SendAgentMessageTool({
        agentId,
        sessionId: this.options.sessionId ?? `session-${Date.now()}`,
        bus: this.options.bus,
        language: this.options.language ?? 'hermes',
      }))
    }

    const agent = new Agent({
      id: agentId,
      name: `SubAgent:${agentId}`,
      provider,
      model,
      tools: subTools,
      systemPrompt: input.systemPrompt,
      workingDir,
      bus: this.options.bus,
      sessionId: this.options.sessionId,
    })

    let accumulatedText = ''

    for await (const event of agent.run(input.task)) {
      if (event.type === 'text') {
        accumulatedText += event.delta
      } else if (event.type === 'error') {
        throw new Error(event.message)
      }
    }

    return accumulatedText
  }

  formatOutput(output: string): string {
    return output
  }

  requiresApproval(): boolean {
    return false
  }
}
