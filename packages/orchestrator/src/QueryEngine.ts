import type { Provider, Message, ToolSchema, ContentBlock } from '@swarm/providers'
import type { AgentTool } from './AgentTool.js'
import { toolToSchema } from './AgentTool.js'

export interface QueryEngineOptions {
  provider: Provider
  model: string
  systemPrompt?: string
  tools?: AgentTool[]
  maxTokens?: number
  thinkingEnabled?: boolean
  workingDir?: string
}

export type TurnEvent =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'tool_start'; toolCallId: string; toolName: string; toolInput: unknown }
  | { type: 'tool_done'; toolCallId: string; toolResult: string; toolError: boolean }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'done'; stopReason: string }
  | { type: 'error'; message: string }

export class QueryEngine {
  private history: Message[]
  private options: QueryEngineOptions

  constructor(options: QueryEngineOptions) {
    this.options = options
    this.history = []
  }

  /**
   * Add a user message and stream the full agent loop (including tool use rounds).
   * Yields TurnEvents as things happen.
   */
  async *turn(userMessage: string): AsyncIterable<TurnEvent> {
    this.history.push({ role: 'user', content: userMessage })

    // Convert tools to provider-level schemas
    const toolSchemas: ToolSchema[] = (this.options.tools ?? []).map(toolToSchema)

    const streamOpts = {
      maxTokens: this.options.maxTokens,
      systemPrompt: this.options.systemPrompt,
      thinkingEnabled: this.options.thinkingEnabled,
    }

    // Agent loop — keeps going as long as the model returns tool_use stop reason
    let continueLoop = true
    while (continueLoop) {
      // Accumulated content for the assistant turn
      let textAccumulated = ''
      const toolUseBlocks: Array<{ type: 'tool_use'; id: string; name: string; input: unknown }> = []

      // Tool calls encountered during this stream pass; we execute them after the stream
      const pendingToolCalls: Array<{ id: string; name: string; input: unknown }> = []

      let stopReason = 'end_turn'

      try {
        const stream = this.options.provider.stream(
          this.options.model,
          this.history,
          toolSchemas,
          streamOpts,
        )

        for await (const event of stream) {
          if (event.type === 'text') {
            textAccumulated += event.delta
            yield { type: 'text', delta: event.delta }
          } else if (event.type === 'thinking') {
            yield { type: 'thinking', delta: event.delta }
          } else if (event.type === 'tool_call') {
            toolUseBlocks.push({ type: 'tool_use', id: event.id, name: event.name, input: event.input })
            pendingToolCalls.push({ id: event.id, name: event.name, input: event.input })
            yield { type: 'tool_start', toolCallId: event.id, toolName: event.name, toolInput: event.input }
          } else if (event.type === 'usage') {
            yield { type: 'usage', inputTokens: event.inputTokens, outputTokens: event.outputTokens }
          } else if (event.type === 'done') {
            stopReason = event.stop_reason
          } else if (event.type === 'error') {
            yield { type: 'error', message: event.message }
            // Non-retryable errors terminate the loop
            continueLoop = false
            break
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        yield { type: 'error', message }
        continueLoop = false
        break
      }

      // Build and push the accumulated assistant message to history
      const assistantContent: ContentBlock[] = []
      if (textAccumulated) {
        assistantContent.push({ type: 'text', text: textAccumulated })
      }
      for (const block of toolUseBlocks) {
        assistantContent.push(block)
      }

      if (assistantContent.length > 0) {
        this.history.push({ role: 'assistant', content: assistantContent })
      }

      if (stopReason === 'tool_use' && pendingToolCalls.length > 0) {
        // Execute all pending tool calls and collect results
        const toolResultBlocks: ContentBlock[] = []

        for (const tc of pendingToolCalls) {
          const { id, name, input } = tc
          const tool = (this.options.tools ?? []).find(t => t.name === name)

          let resultText: string
          let isError = false

          if (!tool) {
            resultText = `Error: unknown tool "${name}"`
            isError = true
          } else {
            try {
              const parsed = tool.inputSchema.parse(input)
              const output = await tool.call(parsed, {
                workingDir: this.options.workingDir ?? process.cwd(),
              })
              resultText = tool.formatOutput(output)
            } catch (err) {
              resultText = err instanceof Error ? err.message : String(err)
              isError = true
            }
          }

          toolResultBlocks.push({
            type: 'tool_result',
            tool_use_id: id,
            content: resultText,
            is_error: isError || undefined,
          })

          yield { type: 'tool_done', toolCallId: id, toolResult: resultText, toolError: isError }
        }

        // Push tool results as a user message and loop
        this.history.push({ role: 'user', content: toolResultBlocks })
        continueLoop = true
      } else {
        // No tool use — signal done and exit loop
        yield { type: 'done', stopReason }
        continueLoop = false
      }
    }
  }

  /** Return a copy of the current message history. */
  getHistory(): Message[] {
    return [...this.history]
  }

  /** Clear history, starting a new session. */
  reset(): void {
    this.history = []
  }

  /** Hot-swap the provider and model mid-session. */
  swapProvider(provider: Provider, model: string): void {
    this.options.provider = provider
    this.options.model = model
  }

  /**
   * Compact history by keeping only the last `keepLast` messages.
   * Older messages are discarded. Defaults to 20.
   */
  compact(keepLast = 20): void {
    if (this.history.length > keepLast) {
      this.history = this.history.slice(this.history.length - keepLast)
    }
  }
}
