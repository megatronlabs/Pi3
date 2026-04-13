import path from 'path'
import { z } from 'zod'
import { Tool, ToolContext, ToolResult } from '../types'

const inputSchema = z.object({
  pattern: z.string(),
  path: z.string().optional(),
  limit: z.number().optional().default(100),
})

type GlobInput = z.input<typeof inputSchema>

interface FileEntry {
  filePath: string
  mtime: number | Date
}

export class GlobTool implements Tool<GlobInput, ToolResult> {
  name = 'glob'
  description = 'Find files matching a glob pattern, sorted by modification time'
  inputSchema = inputSchema

  isConcurrencySafe(_input: GlobInput): boolean {
    return true
  }

  isDestructive(_input: GlobInput): boolean {
    return false
  }

  requiresApproval(_input: GlobInput): boolean {
    return false
  }

  async call(input: GlobInput, ctx: ToolContext): Promise<ToolResult> {
    const parsed = inputSchema.parse(input)
    const searchDir = parsed.path
      ? path.isAbsolute(parsed.path)
        ? parsed.path
        : path.join(ctx.workingDir, parsed.path)
      : ctx.workingDir

    try {
      const glob = new Bun.Glob(parsed.pattern)
      const matches: string[] = []
      const collectLimit = parsed.limit * 5

      for await (const match of glob.scan({ cwd: searchDir, absolute: true })) {
        matches.push(match)
        if (matches.length >= collectLimit) {
          break
        }
      }

      // Stat all files to get mtime
      const entries: FileEntry[] = await Promise.all(
        matches.map(async (filePath) => {
          try {
            const stat = await Bun.file(filePath).stat()
            return { filePath, mtime: stat.mtime }
          } catch {
            return { filePath, mtime: 0 }
          }
        })
      )

      // Sort descending by mtime (most recently modified first)
      const toMs = (m: number | Date): number =>
        m instanceof Date ? m.getTime() : m
      entries.sort((a, b) => toMs(b.mtime) - toMs(a.mtime))

      const limited = entries.slice(0, parsed.limit).map(e => e.filePath)

      if (limited.length === 0) {
        return {
          success: true,
          output: '(no files matched)',
        }
      }

      return {
        success: true,
        output: limited.join('\n'),
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
