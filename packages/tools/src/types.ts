import { ZodType } from 'zod'

export interface ToolContext {
  workingDir: string        // current working directory for the agent
  abortSignal?: AbortSignal // cancellation signal
}

export interface Tool<
  TInput = unknown,
  TOutput = unknown,
  TProgress = void
> {
  name: string
  description: string
  inputSchema: ZodType<TInput>
  call(
    input: TInput,
    ctx: ToolContext,
    onProgress?: (progress: TProgress) => void
  ): Promise<TOutput>
  isConcurrencySafe(input: TInput): boolean
  isDestructive?(input: TInput): boolean
  // If true, requires user approval before running
  requiresApproval?(input: TInput): boolean
}

export interface ToolResult {
  success: boolean
  output: string       // always a string for LLM consumption
  error?: string
}
