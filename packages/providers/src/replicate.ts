import type { Provider, Message, ToolSchema, StreamEvent, StreamOpts, ContentBlock } from './types.js'

// ── OpenAI-compat shapes (shared with prediction SSE path) ──────────────────

interface OAIMessage {
  role: string
  content: string | OAIContentPart[]
  tool_call_id?: string
  name?: string
}

interface OAIContentPart {
  type: 'text'
  text: string
}

interface OAITool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: unknown
  }
}

interface OAIDelta {
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

interface OAIChunk {
  id: string
  choices: Array<{
    index: number
    delta: OAIDelta
    finish_reason?: string | null
  }>
}

// ── Replicate prediction API shapes ─────────────────────────────────────────

interface ReplicatePredictionResponse {
  id: string
  status: string
  urls?: {
    stream?: string
    get?: string
    cancel?: string
  }
  error?: string | null
}

// ── Hardcoded popular LLM models on Replicate ────────────────────────────────

const REPLICATE_MODELS: string[] = [
  'meta/meta-llama-3-70b-instruct',
  'meta/meta-llama-3-8b-instruct',
  'mistralai/mistral-7b-instruct-v0.2',
  'mistralai/mixtral-8x7b-instruct-v0.1',
  'snowflake/snowflake-arctic-instruct',
]

// ── Provider ─────────────────────────────────────────────────────────────────

export class ReplicateProvider implements Provider {
  readonly id = 'replicate'
  readonly name = 'Replicate'

  private readonly apiKey: string
  private readonly baseUrl = 'https://api.replicate.com/v1'

  constructor(config: { apiKey: string }) {
    this.apiKey = config.apiKey
  }

  async listModels(): Promise<string[]> {
    return REPLICATE_MODELS
  }

  async *stream(
    model: string,
    messages: Message[],
    tools: ToolSchema[],
    opts: StreamOpts = {}
  ): AsyncIterable<StreamEvent> {
    try {
      const oaiMessages = this.convertMessages(messages, opts.systemPrompt)
      const oaiTools: OAITool[] = tools.map(t => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }))

      // ── Attempt 1: OpenAI-compat endpoint ──────────────────────────────────
      const compatBody: Record<string, unknown> = {
        model,
        messages: oaiMessages,
        stream: true,
        ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(oaiTools.length > 0 ? { tools: oaiTools } : {}),
      }

      const compatRes = await fetch(`${this.baseUrl}/openai/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(compatBody),
      })

      if (compatRes.ok) {
        // Stream succeeded via OpenAI-compat path
        yield* this.parseOAIStream(compatRes)
        return
      }

      // ── Attempt 2: Prediction SSE fallback ─────────────────────────────────
      // Build a flat prompt string for models that don't support chat format
      const sseResult = yield* this.streamViaPrediction(model, oaiMessages, opts)
      return sseResult
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      yield { type: 'error', message, retryable: true }
    }
  }

  // ── OpenAI-compat SSE parser ───────────────────────────────────────────────

  private async *parseOAIStream(res: Response): AsyncIterable<StreamEvent> {
    if (!res.body) {
      yield { type: 'error', message: 'Replicate OpenAI-compat response has no body', retryable: false }
      return
    }

    const toolAccum = new Map<number, { id: string; name: string; argsRaw: string }>()
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let doneEmitted = false

    try {
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
            for (const [, accum] of toolAccum) {
              yield { type: 'tool_call', id: accum.id, name: accum.name, input: this.parseArgs(accum.argsRaw) }
            }
            toolAccum.clear()
            if (!doneEmitted) {
              yield { type: 'done', stop_reason: 'end_turn' }
              doneEmitted = true
            }
            continue
          }

          let chunk: OAIChunk
          try {
            chunk = JSON.parse(data) as OAIChunk
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
                  toolAccum.set(idx, { id: tc.id ?? `rep-tool-${idx}`, name: tc.function?.name ?? '', argsRaw: '' })
                }
                const accum = toolAccum.get(idx)!
                if (tc.id) accum.id = tc.id
                if (tc.function?.name) accum.name = tc.function.name
                if (tc.function?.arguments) accum.argsRaw += tc.function.arguments
              }
            }

            if (choice.finish_reason) {
              for (const [, accum] of toolAccum) {
                yield { type: 'tool_call', id: accum.id, name: accum.name, input: this.parseArgs(accum.argsRaw) }
              }
              toolAccum.clear()

              if (!doneEmitted) {
                const rawReason = choice.finish_reason
                const stop_reason =
                  rawReason === 'length' ? 'max_tokens'
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
    } finally {
      reader.releaseLock()
    }

    if (!doneEmitted) {
      for (const [, accum] of toolAccum) {
        yield { type: 'tool_call', id: accum.id, name: accum.name, input: this.parseArgs(accum.argsRaw) }
      }
      yield { type: 'done', stop_reason: 'end_turn' }
    }
  }

  // ── Prediction SSE fallback ────────────────────────────────────────────────

  private async *streamViaPrediction(
    model: string,
    oaiMessages: OAIMessage[],
    opts: StreamOpts
  ): AsyncIterable<StreamEvent> {
    // Build a flat prompt from the OpenAI-format messages
    const prompt = this.buildPromptFromMessages(oaiMessages)

    // Determine the version field: Replicate versioned models use a hash suffix
    // e.g. "owner/model:version" or just "owner/model" for deployment-style
    const [modelPath, version] = model.split(':')
    const predictionBody: Record<string, unknown> = {
      input: {
        prompt,
        ...(opts.maxTokens !== undefined ? { max_new_tokens: opts.maxTokens } : {}),
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      },
      stream: true,
    }

    if (version) {
      predictionBody['version'] = version
    } else {
      // Use the model-specific endpoint
      // Replicate accepts "owner/model" in the body for non-versioned deployments
      predictionBody['version'] = modelPath
    }

    const predRes = await fetch(`${this.baseUrl}/predictions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Token ${this.apiKey}`,
        Prefer: 'wait',
      },
      body: JSON.stringify(predictionBody),
    })

    if (!predRes.ok) {
      const text = await predRes.text().catch(() => predRes.statusText)
      yield {
        type: 'error',
        message: `Replicate prediction request failed: ${predRes.status} ${text}`,
        retryable: predRes.status === 429 || predRes.status >= 500,
      }
      return
    }

    const prediction = await predRes.json() as ReplicatePredictionResponse

    if (prediction.error) {
      yield { type: 'error', message: `Replicate prediction error: ${prediction.error}`, retryable: false }
      return
    }

    const streamUrl = prediction.urls?.stream
    if (!streamUrl) {
      yield { type: 'error', message: 'Replicate prediction response missing urls.stream', retryable: false }
      return
    }

    // GET the SSE stream URL
    const sseRes = await fetch(streamUrl, {
      headers: {
        Accept: 'text/event-stream',
        Authorization: `Token ${this.apiKey}`,
      },
    })

    if (!sseRes.ok) {
      const text = await sseRes.text().catch(() => sseRes.statusText)
      yield {
        type: 'error',
        message: `Replicate SSE stream failed: ${sseRes.status} ${text}`,
        retryable: sseRes.status === 429 || sseRes.status >= 500,
      }
      return
    }

    if (!sseRes.body) {
      yield { type: 'error', message: 'Replicate SSE response has no body', retryable: false }
      return
    }

    const reader = sseRes.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let doneEmitted = false

    // SSE event accumulator: events can span multiple lines
    let eventName = ''
    let eventData = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventName = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            eventData = line.slice(6)
          } else if (line.trim() === '') {
            // Dispatch accumulated event
            if (eventName === 'done' || eventData === '[DONE]') {
              if (!doneEmitted) {
                yield { type: 'done', stop_reason: 'end_turn' }
                doneEmitted = true
              }
            } else if (eventName === 'error') {
              yield { type: 'error', message: `Replicate stream error: ${eventData}`, retryable: false }
              doneEmitted = true
            } else if (eventData) {
              // Try to parse as JSON with an "output" field; fall back to raw text
              try {
                const parsed = JSON.parse(eventData) as Record<string, unknown>
                if (typeof parsed['output'] === 'string') {
                  yield { type: 'text', delta: parsed['output'] }
                }
              } catch {
                // Raw text delta
                yield { type: 'text', delta: eventData }
              }
            }

            // Reset for next event
            eventName = ''
            eventData = ''
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    if (!doneEmitted) {
      yield { type: 'done', stop_reason: 'end_turn' }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private convertMessages(messages: Message[], systemPromptOverride?: string): OAIMessage[] {
    const result: OAIMessage[] = []

    if (systemPromptOverride) {
      result.push({ role: 'system', content: systemPromptOverride })
    }

    for (const msg of messages) {
      if (msg.role === 'system' && !systemPromptOverride) {
        const content = typeof msg.content === 'string'
          ? msg.content
          : (msg.content as ContentBlock[]).map(b => b.type === 'text' ? b.text : '').join('')
        result.push({ role: 'system', content })
        continue
      }
      if (msg.role === 'system') continue

      if (typeof msg.content === 'string') {
        result.push({ role: msg.role, content: msg.content })
        continue
      }

      for (const block of msg.content as ContentBlock[]) {
        if (block.type === 'text') {
          result.push({ role: msg.role, content: block.text })
        } else if (block.type === 'tool_use') {
          result.push({ role: 'assistant', content: `[Tool call: ${block.name}]` })
        } else if (block.type === 'tool_result') {
          result.push({ role: 'tool', content: block.content, tool_call_id: block.tool_use_id })
        }
      }
    }

    return result
  }

  /** Flatten OAI messages into a single prompt string for prediction SSE path. */
  private buildPromptFromMessages(messages: OAIMessage[]): string {
    const parts: string[] = []
    let systemText = ''

    for (const msg of messages) {
      const content = typeof msg.content === 'string'
        ? msg.content
        : (msg.content as OAIContentPart[]).map(p => p.text).join('')

      if (msg.role === 'system') {
        systemText = content
      } else if (msg.role === 'user') {
        parts.push(`Human: ${content}`)
      } else if (msg.role === 'assistant') {
        parts.push(`Assistant: ${content}`)
      } else if (msg.role === 'tool') {
        parts.push(`Tool result: ${content}`)
      }
    }

    const header = systemText ? `System: ${systemText}\n\n` : ''
    return `${header}${parts.join('\n')}\nAssistant:`
  }

  private parseArgs(raw: string): unknown {
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }
}
