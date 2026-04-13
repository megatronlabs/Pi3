import type { Tool, ToolResult } from '@swarm/tools'
import type { AgentTool } from '@swarm/orchestrator'

/**
 * Adapt a @swarm/tools Tool to the @swarm/orchestrator AgentTool interface.
 *
 * The two interfaces are nearly identical — the main difference is AgentTool
 * requires a `formatOutput` method and does not require `isConcurrencySafe`.
 */
export function adaptTool<TInput>(tool: Tool<TInput, ToolResult>): AgentTool<TInput, ToolResult> {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    call: (input: TInput, ctx: { workingDir: string; abortSignal?: AbortSignal }) =>
      tool.call(input, ctx),
    requiresApproval: tool.requiresApproval
      ? (input: TInput) => tool.requiresApproval!(input)
      : undefined,
    formatOutput: (output: ToolResult): string => {
      if (output.success) {
        return output.output
      }
      return output.error ? `Error: ${output.error}\n${output.output}`.trim() : `Error: ${output.output}`
    },
  }
}

/**
 * Adapt an array of @swarm/tools Tool instances to AgentTool instances.
 */
export function adaptTools(tools: Tool[]): AgentTool[] {
  return tools.map(t => adaptTool(t as Tool<unknown, ToolResult>))
}
