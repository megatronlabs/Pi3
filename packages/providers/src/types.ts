// The unified streaming event union — all providers emit these
export type StreamEvent =
  | { type: 'text';       delta: string }
  | { type: 'tool_call';  id: string; name: string; input: unknown }
  | { type: 'thinking';   delta: string }
  | { type: 'usage';      inputTokens: number; outputTokens: number }
  | { type: 'done';       stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop' | string }
  | { type: 'error';      message: string; retryable: boolean }

// A message in the conversation
export type Role = 'user' | 'assistant' | 'system'
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }

export interface Message {
  role: Role
  content: string | ContentBlock[]
}

// Tool schema in provider-neutral format
export interface ToolSchema {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

// Options for a stream call
export interface StreamOpts {
  maxTokens?: number
  temperature?: number
  systemPrompt?: string
  thinkingEnabled?: boolean
  thinkingBudget?: number
}

// The provider interface every adapter must implement
export interface Provider {
  readonly id: string
  readonly name: string
  listModels(): Promise<string[]>
  stream(
    model: string,
    messages: Message[],
    tools: ToolSchema[],
    opts?: StreamOpts
  ): AsyncIterable<StreamEvent>
}

// Registry of available providers
export interface ProviderRegistry {
  register(provider: Provider): void
  get(id: string): Provider | undefined
  list(): Provider[]
}
