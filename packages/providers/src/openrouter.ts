import type { Provider, Message, ToolSchema, StreamEvent, StreamOpts } from './types.js'

interface OpenRouterMessage {
  role: string
  content: string | OpenRouterContentPart[]
  tool_call_id?: string
  name?: string
}

interface OpenRouterContentPart {
  type: 'text'
  text: string
}

interface OpenRouterTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: unknown
  }
}

interface OpenRouterDelta {
  role?: string
  content?: string | null
  tool_calls?: Array<{
    index: number
    id?: string
    type?: string
    function?: {
      name?: string
      arguments?: string
    }
  }>
}

interface OpenRouterChunk {
  id: string
  choices: Array<{
    index: number
    delta: OpenRouterDelta
    finish_reason?: string | null
  }>
}

interface OpenRouterModelsResponse {
  data: Array<{ id: string }>
}

export class OpenRouterProvider implements Provider {
  readonly id = 'openrouter'
  readonly name = 'OpenRouter'

  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(opts: { apiKey: string; baseUrl?: string }) {
    this.apiKey = opts.apiKey
    this.baseUrl = opts.baseUrl ?? 'https://openrouter.ai/api/v1'
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      })
      if (!res.ok) return []
      const data = await res.json() as OpenRouterModelsResponse
      return data.data.map(m => m.id)
    } catch {
      return []
    }
  }

  async *stream(
    model: string,
    messages: Message[],
    tools: ToolSchema[],
    opts: StreamOpts = {}
  ): AsyncIterable<StreamEvent> {
    try {
      const orMessages: OpenRouterMessage[] = this.convertMessages(messages, opts.systemPrompt)

      const orTools: OpenRouterTool[] = tools.map(t => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }))

      const body: Record<string, unknown> = {
        model,
        messages: orMessages,
        stream: true,
        ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(orTools.length > 0 ? { tools: orTools } : {}),
      }

      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://github.com/swarm/pi3',
          'X-Title': 'Pi3',
        },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText)
        yield {
          type: 'error',
          message: `OpenRouter request failed: ${res.status} ${text}`,
          retryable: res.status === 429 || res.status >= 500,
        }
        return
      }

      if (!res.body) {
        yield { type: 'error', message: 'OpenRouter response has no body', retryable: false }
        return
      }

      // Accumulate tool call deltas: index → { id, name, argsRaw }
      const toolAccum = new Map<number, { id: string; name: string; argsRaw: string }>()

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let doneEmitted = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue

          const data = trimmed.slice(6)
          if (data === '[DONE]') {
            // Flush any accumulated tool calls
            for (const [, accum] of toolAccum) {
              let input: unknown = {}
              try {
                input = JSON.parse(accum.argsRaw)
              } catch {
                input = accum.argsRaw
              }
              yield { type: 'tool_call', id: accum.id, name: accum.name, input }
            }
            toolAccum.clear()

            if (!doneEmitted) {
              yield { type: 'done', stop_reason: 'end_turn' }
              doneEmitted = true
            }
            continue
          }

          let chunk: OpenRouterChunk
          try {
            chunk = JSON.parse(data) as OpenRouterChunk
          } catch {
            continue
          }

          for (const choice of chunk.choices) {
            const delta = choice.delta

            if (delta.content) {
              yield { type: 'text', delta: delta.content }
            }

            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index
                if (!toolAccum.has(idx)) {
                  toolAccum.set(idx, { id: tc.id ?? `or-tool-${idx}`, name: tc.function?.name ?? '', argsRaw: '' })
                }
                const accum = toolAccum.get(idx)!
                if (tc.id) accum.id = tc.id
                if (tc.function?.name) accum.name = tc.function.name
                if (tc.function?.arguments) accum.argsRaw += tc.function.arguments
              }
            }

            if (choice.finish_reason) {
              // Flush accumulated tool calls before done
              for (const [, accum] of toolAccum) {
                let input: unknown = {}
                try {
                  input = JSON.parse(accum.argsRaw)
                } catch {
                  input = accum.argsRaw
                }
                yield { type: 'tool_call', id: accum.id, name: accum.name, input }
              }
              toolAccum.clear()

              if (!doneEmitted) {
                const rawReason = choice.finish_reason
                const stop_reason = rawReason === 'length' ? 'max_tokens'
                  : rawReason === 'tool_calls' ? 'tool_use'
                  : rawReason === 'stop' ? 'end_turn'
                  : rawReason
                yield { type: 'done', stop_reason }
                doneEmitted = true
              }
            }
          }
        }
      }

      // If stream ended without explicit done
      if (!doneEmitted) {
        for (const [, accum] of toolAccum) {
          let input: unknown = {}
          try {
            input = JSON.parse(accum.argsRaw)
          } catch {
            input = accum.argsRaw
          }
          yield { type: 'tool_call', id: accum.id, name: accum.name, input }
        }
        yield { type: 'done', stop_reason: 'end_turn' }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      yield { type: 'error', message, retryable: true }
    }
  }

  private convertMessages(messages: Message[], systemPromptOverride?: string): OpenRouterMessage[] {
    const result: OpenRouterMessage[] = []

    if (systemPromptOverride) {
      result.push({ role: 'system', content: systemPromptOverride })
    }

    for (const msg of messages) {
      if (msg.role === 'system' && !systemPromptOverride) {
        const content = typeof msg.content === 'string'
          ? msg.content
          : msg.content.map(b => b.type === 'text' ? b.text : '').join('')
        result.push({ role: 'system', content })
        continue
      }
      if (msg.role === 'system') continue

      if (typeof msg.content === 'string') {
        result.push({ role: msg.role, content: msg.content })
        continue
      }

      for (const block of msg.content) {
        if (block.type === 'text') {
          result.push({ role: msg.role, content: block.text })
        } else if (block.type === 'tool_use') {
          // This gets serialized as assistant tool_calls — for simplicity represent as text
          result.push({
            role: 'assistant',
            content: `[Tool call: ${block.name}]`,
          })
        } else if (block.type === 'tool_result') {
          result.push({
            role: 'tool',
            content: block.content,
            tool_call_id: block.tool_use_id,
          })
        }
      }
    }

    return result
  }
}
