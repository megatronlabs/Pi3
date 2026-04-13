import type { HermesTool } from './types.js'

/**
 * Serializes an array of tool definitions into a Hermes-format string that
 * should be appended to the system prompt before sending a request.
 *
 * The output follows the NousResearch Hermes tool-calling convention, which
 * wraps a JSON tool manifest in `<tools>` XML and provides the model with
 * clear instructions on how to emit `<tool_call>` blocks.
 *
 * @param tools - The tool definitions to inject.
 * @returns A string ready to append to the system prompt.
 *
 * @example
 * ```ts
 * const injection = buildHermesSystemPrompt([myTool])
 * const systemPrompt = basePrompt + '\n\n' + injection
 * ```
 */
export function buildHermesSystemPrompt(tools: HermesTool[]): string {
  if (tools.length === 0) return ''

  const toolsJson = JSON.stringify(tools, null, 2)

  return `You have access to the following tools:

<tools>
${toolsJson}
</tools>

When you need to call a tool, respond with:
<tool_call>
{"name": "tool_name", "arguments": {"arg1": "value1"}}
</tool_call>

You can call multiple tools in sequence. After receiving tool results, continue your response.`
}
