import { z } from 'zod'
import type { MemoryProvider } from './MemoryProvider.js'

// Minimal AgentTool interface (matches @swarm/orchestrator's AgentTool,
// copied here to avoid a circular dependency).
interface AgentTool<TInput, TOutput> {
  name: string
  description: string
  inputSchema: z.ZodType<TInput>
  call(input: TInput, ctx: { workingDir: string }): Promise<TOutput>
  formatOutput(output: TOutput): string
  requiresApproval?(): boolean
}

// ---------------------------------------------------------------------------
// memory_search
// ---------------------------------------------------------------------------

const MemorySearchSchema = z.object({
  query: z.string().describe('Search query to match against stored memory values'),
  namespace: z.string().optional().describe('Memory namespace to search (default: "default")'),
  limit: z.number().int().positive().optional().describe('Maximum number of results to return (default: 5)'),
})

type MemorySearchInput = z.infer<typeof MemorySearchSchema>

export class MemorySearchTool implements AgentTool<MemorySearchInput, string> {
  name = 'memory_search'
  description = 'Search previously stored memories by keyword or phrase. Returns matching key-value pairs.'
  inputSchema = MemorySearchSchema

  constructor(private provider: MemoryProvider) {}

  async call(input: MemorySearchInput): Promise<string> {
    const ns = input.namespace ?? 'default'
    const results = await this.provider.search(ns, input.query, input.limit ?? 5)
    if (results.length === 0) return 'No memories found.'
    return results
      .map(r => `[${r.namespace}/${r.key}]\n${r.value}`)
      .join('\n\n')
  }

  formatOutput(output: string): string { return output }
  requiresApproval(): boolean { return false }
}

// ---------------------------------------------------------------------------
// memory_read
// ---------------------------------------------------------------------------

const MemoryReadSchema = z.object({
  key: z.string().describe('Key to look up in memory'),
  namespace: z.string().optional().describe('Memory namespace (default: "default")'),
})

type MemoryReadInput = z.infer<typeof MemoryReadSchema>

export class MemoryReadTool implements AgentTool<MemoryReadInput, string> {
  name = 'memory_read'
  description = 'Read a specific memory value by key. Use memory_search first if you are not sure of the exact key.'
  inputSchema = MemoryReadSchema

  constructor(private provider: MemoryProvider) {}

  async call(input: MemoryReadInput): Promise<string> {
    const ns = input.namespace ?? 'default'
    const value = await this.provider.get(ns, input.key)
    return value ?? `No memory found for key '${input.key}'.`
  }

  formatOutput(output: string): string { return output }
  requiresApproval(): boolean { return false }
}
