import { z } from 'zod'
import { Tool, ToolContext, ToolResult } from '../types'

const inputSchema = z.object({
  command: z.string(),
  timeout: z.number().optional().default(30000),
  workingDir: z.string().optional(),
})

type BashInput = z.input<typeof inputSchema>

const DESTRUCTIVE_PATTERNS = [
  /\brm\b/,
  /\brmdir\b/,
  /\bmv\b/,
  /\bdd\b/,
  /\bmkfs\b/,
  /\bformat\b/,
  /\bdrop\b/,
  /\btruncate\b/,
]

function isDestructiveCommand(command: string): boolean {
  return DESTRUCTIVE_PATTERNS.some(p => p.test(command))
}

export class BashTool implements Tool<BashInput, ToolResult> {
  name = 'bash'
  description = 'Execute a shell command and return its output'
  inputSchema = inputSchema

  isConcurrencySafe(_input: BashInput): boolean {
    return false
  }

  isDestructive(input: BashInput): boolean {
    return isDestructiveCommand(input.command)
  }

  requiresApproval(input: BashInput): boolean {
    return this.isDestructive(input)
  }

  async call(input: BashInput, ctx: ToolContext): Promise<ToolResult> {
    const parsed = inputSchema.parse(input)
    const { command, timeout, workingDir } = parsed
    const cwd = workingDir ?? ctx.workingDir

    try {
      const signal = AbortSignal.timeout(timeout)

      const proc = Bun.spawn(['sh', '-c', command], {
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
        signal,
      })

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])

      const combined = [stdout, stderr].filter(Boolean).join('\n')

      if (exitCode !== 0) {
        return {
          success: false,
          output: combined,
          error: `Process exited with code ${exitCode}`,
        }
      }

      return {
        success: true,
        output: combined,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const isTimeout = message.includes('timed out') || message.includes('TimeoutError')
      return {
        success: false,
        output: '',
        error: isTimeout ? `Command timed out after ${input.timeout ?? 30000}ms` : message,
      }
    }
  }
}
