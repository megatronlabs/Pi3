import path from 'path'
import { z } from 'zod'
import { Tool, ToolContext, ToolResult } from '../types'

const inputSchema = z.object({
  pattern: z.string(),
  path: z.string().optional(),
  glob: z.string().optional(),
  ignoreCase: z.boolean().optional().default(false),
  contextLines: z.number().optional().default(0),
  limit: z.number().optional().default(50),
})

type GrepInput = z.input<typeof inputSchema>

async function hasRipgrep(): Promise<boolean> {
  try {
    const proc = Bun.spawn(['which', 'rg'], { stdout: 'pipe', stderr: 'pipe' })
    const code = await proc.exited
    return code === 0
  } catch {
    return false
  }
}

export class GrepTool implements Tool<GrepInput, ToolResult> {
  name = 'grep'
  description =
    'Search file contents for a regex pattern, returning matching lines with file and line number'
  inputSchema = inputSchema

  isConcurrencySafe(_input: GrepInput): boolean {
    return true
  }

  isDestructive(_input: GrepInput): boolean {
    return false
  }

  requiresApproval(_input: GrepInput): boolean {
    return false
  }

  async call(input: GrepInput, ctx: ToolContext): Promise<ToolResult> {
    const parsed = inputSchema.parse(input)
    const searchPath = parsed.path
      ? path.isAbsolute(parsed.path)
        ? parsed.path
        : path.join(ctx.workingDir, parsed.path)
      : ctx.workingDir

    try {
      const useRg = await hasRipgrep()
      let args: string[]

      if (useRg) {
        args = ['rg', '--line-number', '--no-heading', '--color=never']
        if (parsed.ignoreCase) args.push('--ignore-case')
        if (parsed.contextLines > 0) args.push(`--context=${parsed.contextLines}`)
        if (parsed.glob) args.push('--glob', parsed.glob)
        args.push(parsed.pattern, searchPath)
      } else {
        // Fall back to grep
        args = ['grep', '-rn', '--color=never']
        if (parsed.ignoreCase) args.push('-i')
        if (parsed.contextLines > 0) args.push(`-C${parsed.contextLines}`)
        if (parsed.glob) args.push('--include', parsed.glob)
        args.push(parsed.pattern, searchPath)
      }

      const proc = Bun.spawn(args, {
        cwd: ctx.workingDir,
        stdout: 'pipe',
        stderr: 'pipe',
      })

      const [stdout, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        proc.exited,
      ])

      // Exit code 1 from grep/rg means no matches (not an error)
      if (exitCode > 1) {
        const stderr = await new Response(proc.stderr).text()
        return {
          success: false,
          output: '',
          error: stderr.trim() || `Search process exited with code ${exitCode}`,
        }
      }

      if (!stdout.trim()) {
        return {
          success: true,
          output: '(no matches found)',
        }
      }

      const limit = parsed.limit

      // Apply limit: count result lines (skip context separator lines like --)
      const lines = stdout.split('\n').filter(Boolean)
      const matchLines = lines.filter((l: string) => !l.match(/^--$/))
      const limited = matchLines.slice(0, limit)

      const truncated = limited.length < matchLines.length
      const output =
        limited.join('\n') +
        (truncated
          ? `\n\n(results truncated — showing ${limited.length} of ${matchLines.length} matches)`
          : '')

      return {
        success: true,
        output,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        success: false,
        output: '',
        error: message,
      }
    }
  }
}
