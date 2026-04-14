import { randomUUID } from 'crypto'

// ---------------------------------------------------------------------------
// Operation modes — how agents coordinate with each other
// ---------------------------------------------------------------------------

/**
 * orchestrated  — a central orchestrator directs agents top-down; agents report back up
 * choreographed — agents follow a predefined pipeline, each passing work to the next
 * adhoc         — peer-to-peer; any agent can message any other at any time
 */
export type CommunicationMode = 'orchestrated' | 'choreographed' | 'adhoc'

/**
 * hermes  — structured Hermes XML (fewer tokens, faster; best for 7B+ and API models)
 * english — natural language prose (more readable; better for small local models <4B)
 */
export type CommunicationLanguage = 'hermes' | 'english'

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

/**
 * directive  — orchestrator → worker: here is your assignment
 * query      — banter: asking a question, expects a reply (await_reply=true)
 * reply      — banter: answer to a query; must include correlationId
 * result     — fire-and-forget: task complete, here is the output
 * status     — fire-and-forget: current state update ("analyzing auth module…")
 * vote       — fire-and-forget: binary/choice answer for collective decisions
 * broadcast  — fire-and-forget: informational message to all agents
 */
export type AgentMessageType =
  | 'directive'
  | 'query'
  | 'reply'
  | 'result'
  | 'status'
  | 'vote'
  | 'broadcast'

export interface AgentMessage {
  id: string
  sessionId: string
  from: string               // agent ID
  to: string                 // agent ID | 'orchestrator' | 'all'
  type: AgentMessageType
  language: CommunicationLanguage
  content: string            // serialized message body
  correlationId?: string     // reply → original query linkage
  replyTo?: string           // thread this message off any prior message (more general than correlationId)
  timestamp: Date
  // OTEL-compatible tracing fields
  traceId: string
  spanId: string
  parentSpanId?: string
}

export function createMessage(
  opts: Omit<AgentMessage, 'id' | 'timestamp' | 'traceId' | 'spanId'> & {
    traceId?: string
    spanId?: string
  },
): AgentMessage {
  return {
    ...opts,
    id: randomUUID(),
    timestamp: new Date(),
    traceId: opts.traceId ?? randomUUID().replace(/-/g, ''),
    spanId: opts.spanId ?? randomUUID().replace(/-/g, '').slice(0, 16),
  }
}

// ---------------------------------------------------------------------------
// Context formatting — how messages appear when injected into an agent's LLM context
// ---------------------------------------------------------------------------

/**
 * Format a message for injection into an agent's LLM context.
 *
 * hermes:  wraps in <agent_message> XML tags (matches existing Hermes tool format)
 * english: plain header + prose (readable, reliable for small models)
 */
export function formatMessageForContext(msg: AgentMessage): string {
  if (msg.language === 'hermes') {
    const corrAttr = msg.correlationId ? ` correlation_id="${msg.correlationId}"` : ''
    return (
      `<agent_message` +
      ` id="${msg.id}"` +
      ` from="${msg.from}"` +
      ` to="${msg.to}"` +
      ` type="${msg.type}"` +
      ` trace_id="${msg.traceId}"` +
      `${corrAttr}>\n` +
      `${msg.content}\n` +
      `</agent_message>`
    )
  }

  // English format
  const corrLine = msg.correlationId ? `\nReply-To : ${msg.correlationId}` : ''
  return (
    `[AGENT MESSAGE]\n` +
    `From     : ${msg.from}\n` +
    `To       : ${msg.to}\n` +
    `Type     : ${msg.type}` +
    corrLine + '\n' +
    `Trace    : ${msg.traceId}\n` +
    `---\n` +
    msg.content
  )
}
