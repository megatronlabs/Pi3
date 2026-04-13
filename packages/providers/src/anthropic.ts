import Anthropic from '@anthropic-ai/sdk'
import type {
  MessageParam,
  Tool,
  ThinkingConfigParam,
  ContentBlockParam,
} from '@anthropic-ai/sdk/resources/messages/messages.js'
import type { Provider, Message, ToolSchema, StreamEvent, StreamOpts, ContentBlock } from './types.js'

export class AnthropicProvider implements Provider {
  readonly id = 'anthropic'
  readonly name = 'Anthropic'

  private readonly client: Anthropic

  constructor(opts?: { apiKey?: string }) {
    const apiKey = opts?.apiKey ?? process.env['ANTHROPIC_API_KEY']
    this.client = new Anthropic({ apiKey })
  }

  async listModels(): Promise<string[]> {
    return [
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001',
    ]
  }

  async *stream(
    model: string,
    messages: Message[],
    tools: ToolSchema[],
    opts: StreamOpts = {}
  ): AsyncIterable<StreamEvent> {
    try {
      const anthropicMessages: MessageParam[] = messages
        .filter(m => m.role !== 'system')
        .map(m => this.convertMessage(m))

      const systemMsg = messages.find(m => m.role === 'system')
      const systemPrompt = opts.systemPrompt ?? (systemMsg ? (typeof systemMsg.content === 'string' ? systemMsg.content : '') : undefined)

      const anthropicTools: Tool[] = tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }))

      const thinkingConfig: ThinkingConfigParam | undefined =
        opts.thinkingEnabled
          ? { type: 'enabled', budget_tokens: opts.thinkingBudget ?? 8000 }
          : undefined

      // Track token usage across the stream
      let inputTokens = 0
      let outputTokens = 0

      // Track tool call accumulation: index → { id, name, inputRaw }
      const toolCallAccum = new Map<number, { id: string; name: string; inputRaw: string }>()

      const streamParams = {
        model,
        max_tokens: opts.maxTokens ?? 4096,
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(systemPrompt ? { system: systemPrompt } : {}),
        messages: anthropicMessages,
        ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
        ...(thinkingConfig ? { thinking: thinkingConfig } : {}),
      }

      const stream = this.client.messages.stream(streamParams)

      for await (const event of stream) {
        if (event.type === 'message_start') {
          inputTokens = event.message.usage.input_tokens
          outputTokens = event.message.usage.output_tokens
        } else if (event.type === 'content_block_start') {
          const block = event.content_block
          if (block.type === 'tool_use') {
            toolCallAccum.set(event.index, {
              id: block.id,
              name: block.name,
              inputRaw: '',
            })
          }
        } else if (event.type === 'content_block_delta') {
          const delta = event.delta
          if (delta.type === 'text_delta') {
            yield { type: 'text', delta: delta.text }
          } else if (delta.type === 'thinking_delta') {
            yield { type: 'thinking', delta: delta.thinking }
          } else if (delta.type === 'input_json_delta') {
            const accum = toolCallAccum.get(event.index)
            if (accum) {
              accum.inputRaw += delta.partial_json
            }
          }
        } else if (event.type === 'content_block_stop') {
          const accum = toolCallAccum.get(event.index)
          if (accum) {
            let input: unknown = {}
            try {
              input = JSON.parse(accum.inputRaw)
            } catch {
              input = accum.inputRaw
            }
            yield { type: 'tool_call', id: accum.id, name: accum.name, input }
            toolCallAccum.delete(event.index)
          }
        } else if (event.type === 'message_delta') {
          if (event.usage) {
            outputTokens = event.usage.output_tokens
          }
          if (event.delta.stop_reason) {
            const rawReason = event.delta.stop_reason
            // Normalize stop_sequence → stop
            const stop_reason = rawReason === 'stop_sequence' ? 'stop' : rawReason
            yield { type: 'usage', inputTokens, outputTokens }
            yield { type: 'done', stop_reason }
          }
        }
      }
    } catch (err) {
      const isRetryable = err instanceof Anthropic.APIError
        ? err.status === 429 || err.status === 529 || (err.status >= 500)
        : true
      const message = err instanceof Error ? err.message : String(err)
      yield { type: 'error', message, retryable: isRetryable }
    }
  }

  private convertMessage(msg: Message): MessageParam {
    if (typeof msg.content === 'string') {
      return { role: msg.role as 'user' | 'assistant', content: msg.content }
    }

    const blocks: ContentBlockParam[] = msg.content.map(b => this.convertBlock(b))
    return { role: msg.role as 'user' | 'assistant', content: blocks }
  }

  private convertBlock(block: ContentBlock): ContentBlockParam {
    if (block.type === 'text') {
      return { type: 'text', text: block.text }
    }
    if (block.type === 'tool_use') {
      return {
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: block.input as Record<string, unknown>,
      }
    }
    // tool_result
    return {
      type: 'tool_result',
      tool_use_id: block.tool_use_id,
      content: block.content,
      ...(block.is_error !== undefined ? { is_error: block.is_error } : {}),
    }
  }
}
