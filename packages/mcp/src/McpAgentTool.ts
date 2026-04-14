import { z } from 'zod'
import type { McpClient } from './McpClient.js'
import type { McpTool } from './types.js'

// Local minimal AgentTool interface — matches @swarm/orchestrator's AgentTool exactly
export interface AgentTool<TInput = Record<string, unknown>, TOutput = string> {
  name: string
  description: string
  inputSchema: z.ZodType<TInput>
  call(input: TInput, ctx: { workingDir: string; abortSignal?: AbortSignal }): Promise<TOutput>
  formatOutput(output: TOutput): string
  requiresApproval?(input: TInput): boolean
}

export class McpAgentTool implements AgentTool<Record<string, unknown>, string> {
  name: string
  description: string
  inputSchema: z.ZodType<Record<string, unknown>>

  constructor(
    private client: McpClient,
    private tool: McpTool,
  ) {
    // Prefix name with server name to avoid collisions: "server__toolname"
    this.name = `${client.name}__${tool.name}`.replace(/[^a-zA-Z0-9_]/g, '_')
    this.description = tool.description ?? tool.name

    // Build a Zod schema from the JSON Schema inputSchema
    // For now, accept any object (full JSON Schema → Zod conversion is complex)
    this.inputSchema = z.record(z.string(), z.unknown()) as z.ZodType<Record<string, unknown>>
  }

  async call(input: Record<string, unknown>): Promise<string> {
    return this.client.callTool(this.tool.name, input)
  }

  formatOutput(output: string): string {
    return output
  }

  requiresApproval(_input: Record<string, unknown>): boolean {
    return false
  }
}
