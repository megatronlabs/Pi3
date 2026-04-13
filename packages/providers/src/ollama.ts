import type { Provider, Message, ToolSchema, StreamEvent, StreamOpts } from './types.js'
import { buildHermesSystemPrompt, parseHermesResponse } from '@swarm/hermes'
import type { HermesTool } from '@swarm/hermes'

interface OllamaMessage {
  role: string
  content: string
  tool_calls?: OllamaToolCall[]
}

interface OllamaToolCall {
  function: {
    name: string
    arguments: Record<string, unknown>
  }
}

interface OllamaChunk {
  model?: string
  message?: OllamaMessage
  done: boolean
  done_reason?: string
  prompt_eval_count?: number
  eval_count?: number
}

interface OllamaTagsResponse {
  models: Array<{ name: string }>
}

function toolSchemaToHermes(t: ToolSchema): HermesTool {
  return {
    name: t.name,
    description: t.description,
    parameters: t.inputSchema as HermesTool['parameters'],
  }
}

function uniqueToolId(): string {
  return `ollama-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export class OllamaProvider implements Provider {
  readonly id = 'ollama'
  readonly name = 'Ollama'

  private readonly baseUrl: string

  constructor(opts?: { baseUrl?: string }) {
    this.baseUrl = opts?.baseUrl ?? process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434'
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`)
      if (!res.ok) return []
      const data = await res.json() as OllamaTagsResponse
      return data.models.map(m => m.name)
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
    // First attempt: native tool calling
    if (tools.length > 0) {
      const nativeResult = yield* this.streamNative(model, messages, tools, opts)
      if (nativeResult !== 'no_tools_support') return
      // Model doesn't support native tools — fall through to Hermes
    } else {
      yield* this.streamNative(model, messages, [], opts)
      return
    }

    // Hermes fallback: inject tools as system prompt, parse <tool_call> tags from response
    yield* this.streamHermes(model, messages, tools, opts)
  }

  private async *streamNative(
    model: string,
    messages: Message[],
    tools: ToolSchema[],
    opts: StreamOpts
  ): AsyncIterable<StreamEvent> | AsyncGenerator<StreamEvent, 'no_tools_support' | void> {
    const ollamaMessages = this.convertMessages(messages, opts.systemPrompt)
    const ollamaTools = tools.map(t => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }))

    const body: Record<string, unknown> = {
      model,
      messages: ollamaMessages,
      stream: true,
      ...(ollamaTools.length > 0 ? { tools: ollamaTools } : {}),
      options: {
        ...(opts.maxTokens !== undefined ? { num_predict: opts.maxTokens } : {}),
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      },
    }

    let res: Response
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      yield { type: 'error', message, retryable: false }
      return
    }

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      // 400 + "does not support tools" → signal caller to use Hermes fallback
      if (res.status === 400 && text.includes('does not support tools') && tools.length > 0) {
        return 'no_tools_support'
      }
      yield { type: 'error', message: `Ollama request failed: ${res.status} ${text}`, retryable: res.status >= 500 }
      return
    }

    if (!res.body) {
      yield { type: 'error', message: 'Ollama response has no body', retryable: false }
      return
    }

    yield* this.readNdjsonStream(res.body)
  }

  private async *streamHermes(
    model: string,
    messages: Message[],
    tools: ToolSchema[],
    opts: StreamOpts
  ): AsyncIterable<StreamEvent> {
    // Build Hermes system prompt with tool definitions injected
    const hermesTools = tools.map(toolSchemaToHermes)
    const hermesSystemPrompt = buildHermesSystemPrompt(hermesTools)
    const combinedSystem = opts.systemPrompt
      ? `${opts.systemPrompt}\n\n${hermesSystemPrompt}`
      : hermesSystemPrompt

    const ollamaMessages = this.convertMessages(messages, combinedSystem, true)

    const body: Record<string, unknown> = {
      model,
      messages: ollamaMessages,
      stream: true,
      options: {
        ...(opts.maxTokens !== undefined ? { num_predict: opts.maxTokens } : {}),
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      },
    }

    let res: Response
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      yield { type: 'error', message, retryable: false }
      return
    }

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      yield { type: 'error', message: `Ollama request failed: ${res.status} ${text}`, retryable: res.status >= 500 }
      return
    }

    if (!res.body) {
      yield { type: 'error', message: 'Ollama response has no body', retryable: false }
      return
    }

    // Buffer the entire response — Hermes tags can't be parsed mid-stream
    let accumulated = ''
    let doneEvent: StreamEvent | null = null
    for await (const event of this.readNdjsonStream(res.body)) {
      if (event.type === 'text') {
        accumulated += event.delta
      } else if (event.type === 'done') {
        doneEvent = event
      } else {
        yield event
      }
    }

    // Strip common Hermes format bleed-through prefixes models echo back
    accumulated = accumulated.replace(/^(assistant\s*:\s*)+/i, '').trimStart()

    // Parse accumulated text for tool calls (XML tags or bare JSON fallback)
    const parsed = parseHermesResponse(accumulated)
    if (parsed.toolCalls.length > 0) {
      if (parsed.textBefore.trim()) {
        yield { type: 'text', delta: parsed.textBefore.trim() }
      }
      for (const tc of parsed.toolCalls) {
        yield { type: 'tool_call', id: uniqueToolId(), name: tc.name, input: tc.arguments }
      }
      yield { type: 'done', stop_reason: 'tool_use' }
    } else {
      if (accumulated) yield { type: 'text', delta: accumulated }
      if (doneEvent) yield doneEvent
    }
  }

  private async *readNdjsonStream(body: ReadableStream<Uint8Array>): AsyncIterable<StreamEvent> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue

          let chunk: OllamaChunk
          try {
            chunk = JSON.parse(trimmed) as OllamaChunk
          } catch {
            continue
          }

          if (chunk.message) {
            if (chunk.message.content) {
              yield { type: 'text', delta: chunk.message.content }
            }
            if (chunk.message.tool_calls) {
              for (const tc of chunk.message.tool_calls) {
                yield {
                  type: 'tool_call',
                  id: uniqueToolId(),
                  name: tc.function.name,
                  input: tc.function.arguments,
                }
              }
            }
          }

          if (chunk.done) {
            const raw = chunk.done_reason ?? 'end_turn'
            const stop_reason = raw === 'length' ? 'max_tokens' : raw === 'stop' ? 'stop' : raw
            if (chunk.prompt_eval_count !== undefined || chunk.eval_count !== undefined) {
              yield { type: 'usage', inputTokens: chunk.prompt_eval_count ?? 0, outputTokens: chunk.eval_count ?? 0 }
            }
            yield { type: 'done', stop_reason }
          }
        }
      }

      // Flush remaining buffer
      if (buffer.trim()) {
        try {
          const chunk = JSON.parse(buffer.trim()) as OllamaChunk
          if (chunk.done) {
            const raw = chunk.done_reason ?? 'end_turn'
            const stop_reason = raw === 'length' ? 'max_tokens' : raw === 'stop' ? 'stop' : raw
            if (chunk.prompt_eval_count !== undefined || chunk.eval_count !== undefined) {
              yield { type: 'usage', inputTokens: chunk.prompt_eval_count ?? 0, outputTokens: chunk.eval_count ?? 0 }
            }
            yield { type: 'done', stop_reason }
          }
        } catch { /* ignore */ }
      }
    } finally {
      reader.releaseLock()
    }
  }

  private convertMessages(messages: Message[], systemPromptOverride?: string, hermesMode = false): OllamaMessage[] {
    const result: OllamaMessage[] = []

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

      // Collect text and tool_result blocks per message
      const textParts: string[] = []
      const toolResults: Array<{ name?: string; content: string; is_error?: boolean }> = []

      for (const block of msg.content) {
        if (block.type === 'text') {
          textParts.push(block.text)
        } else if (block.type === 'tool_result') {
          const content = typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
          toolResults.push({ content, is_error: block.is_error })
        }
      }

      if (textParts.length > 0) {
        result.push({ role: msg.role, content: textParts.join('\n') })
      }

      if (toolResults.length > 0) {
        if (hermesMode) {
          // In Hermes mode, inject tool results as user messages with <tool_response> tags
          // so the model recognizes the result and stops calling the same tool again
          const toolResponseContent = toolResults
            .map(tr => `<tool_response>\n${tr.content}\n</tool_response>`)
            .join('\n')
          result.push({ role: 'user', content: toolResponseContent })
        } else {
          // Native tool mode: use role: 'tool'
          for (const tr of toolResults) {
            result.push({ role: 'tool', content: tr.content })
          }
        }
      }
    }

    return result
  }
}
