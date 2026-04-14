// Re-exported from @swarm/bus for backward compatibility.
// AgentMessage types now live in the bus package so that both orchestrator
// and telemetry can depend on them without circular references.
export type {
  CommunicationMode,
  CommunicationLanguage,
  AgentMessageType,
  AgentMessage,
} from '@swarm/bus'

export { createMessage, formatMessageForContext } from '@swarm/bus'
