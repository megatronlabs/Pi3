import { z } from 'zod'
import { randomUUID } from 'crypto'
import type { AgentTool } from './AgentTool.js'
import type { MessageBus, CommunicationLanguage, AgentMessage } from '@swarm/bus'
import { createMessage, formatMessageForContext } from '@swarm/bus'

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SendAgentMessageInputSchema = z.object({
  to: z
    .string()
    .describe('Target agent ID, "orchestrator", or "all" for a broadcast to every agent'),

  type: z
    .enum(['directive', 'query', 'reply', 'result', 'status', 'vote', 'broadcast'])
    .describe(
      'Message type.\n' +
      '  query     — banter: ask a question, set await_reply=true to block for the answer\n' +
      '  reply     — banter: respond to a query; include correlation_id from the original query\n' +
      '  directive — orchestrator assigning work to a worker\n' +
      '  result    — fire-and-forget: report task completion\n' +
      '  status    — fire-and-forget: report current state ("analyzing auth module…")\n' +
      '  vote      — fire-and-forget: binary/choice answer for collective decisions\n' +
      '  broadcast — fire-and-forget: informational message to all agents',
    ),

  content: z.string().describe('Message body — what you want to say'),

  correlation_id: z
    .string()
    .optional()
    .describe('For reply messages: the id of the original query you are responding to'),

  await_reply: z
    .boolean()
    .optional()
    .describe(
      'Block and wait for a reply (banter). ' +
      'Only meaningful when type="query". ' +
      'Fire-and-forget types (status, vote, result, broadcast) should omit or set false.',
    ),

  timeout_ms: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Banter reply timeout in milliseconds (default 30 s)'),
})

export type SendAgentMessageInput = z.infer<typeof SendAgentMessageInputSchema>

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export class SendAgentMessageTool implements AgentTool<SendAgentMessageInput, string> {
  name = 'send_agent_message'
  description =
    'Send a message to another agent or broadcast to all agents. ' +
    'Supports banter (await_reply=true for query type) — blocks until the target replies — ' +
    'and fire-and-forget (await_reply=false) for status updates, votes, and results.'
  inputSchema = SendAgentMessageInputSchema

  constructor(
    private opts: {
      agentId: string
      sessionId: string
      bus: MessageBus
      language: CommunicationLanguage
      /** Optional parent traceId for OTEL propagation */
      traceId?: string
    },
  ) {}

  async call(input: SendAgentMessageInput): Promise<string> {
    const { agentId, sessionId, bus, language, traceId } = this.opts

    const msg = createMessage({
      sessionId,
      from: agentId,
      to: input.to,
      type: input.type,
      language,
      content: input.content,
      correlationId: input.correlation_id,
      parentSpanId: traceId,
    })

    // Banter: publish and wait for a reply
    if ((input.await_reply ?? false) && input.type === 'query') {
      const reply = await bus.banter(msg, input.timeout_ms ?? 30_000)
      return `[Reply from ${reply.from}]\n${reply.content}`
    }

    // Fire-and-forget
    bus.publish(msg)
    return `Message sent to ${input.to} (${input.type})`
  }

  formatOutput(output: string): string {
    return output
  }

  requiresApproval(): boolean {
    return false
  }
}

// ---------------------------------------------------------------------------
// Helper: build the system prompt addendum that tells an agent about the bus
// ---------------------------------------------------------------------------

/**
 * Returns a system prompt snippet that explains the messaging tools to the agent.
 * Prepend this to your existing systemPrompt when bus is active.
 */
export function buildCommSystemPrompt(
  agentId: string,
  mode: string,
  language: CommunicationLanguage,
): string {
  return (
    `\n\n## Inter-Agent Communication\n` +
    `You are agent "${agentId}" operating in ${mode} mode.\n` +
    `Communication language: ${language === 'hermes' ? 'Hermes XML (structured)' : 'English (natural language)'}.\n\n` +
    `Use send_agent_message to:\n` +
    `  • Ask another agent a question and wait for their reply (type="query", await_reply=true)\n` +
    `  • Reply to a query you received (type="reply", include correlation_id)\n` +
    `  • Report your status to the orchestrator (type="status")\n` +
    `  • Cast a vote in a group decision (type="vote", content="yes"|"no"|your-choice)\n` +
    `  • Broadcast info to all agents (type="broadcast")\n\n` +
    `When you receive a message in your context marked [AGENT MESSAGE] or <agent_message>, ` +
    `respond appropriately — reply if it's a query, act if it's a directive.`
  )
}
