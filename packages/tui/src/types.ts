export type MessageRole = 'user' | 'assistant' | 'system'

export type MessageContent =
  | { kind: 'text'; text: string }
  | { kind: 'tool_use'; id: string; name: string; input: unknown; status: 'pending' | 'running' | 'done' | 'error' }
  | { kind: 'tool_result'; tool_use_id: string; content: string; is_error: boolean }
  | { kind: 'thinking'; text: string }
  | { kind: 'error'; message: string }

export interface ChatMessage {
  id: string
  role: MessageRole
  content: MessageContent[]
  timestamp: Date
}

export interface AgentInfo {
  id: string
  name: string
  model: string
  provider: string
  status: 'idle' | 'running' | 'done' | 'error'
  task?: string
  messageCount: number
}
