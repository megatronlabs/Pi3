import path from 'path'
import { z } from 'zod'
import { Tool, ToolContext, ToolResult } from '../types'

const inputSchema = z.object({
  path: z.string(),
  startLine: z.number().optional(),
  endLine: z.number().optional(),
})

type FileReadInput = z.infer<typeof inputSchema>

function formatWithLineNumbers(lines: string[], offset: number): string {
  return lines
    .map((line, i) => {
      const lineNum = offset + i
      const padded = String(lineNum).padStart(3)
      return `${padded}\t${line}`
    })
    .join('\n')
}

export class FileReadTool implements Tool<FileReadInput, ToolResult> {
  name = 'file_read'
  description = 'Read the contents of a file, optionally within a line range'
  inputSchema = inputSchema

  isConcurrencySafe(_input: FileReadInput): boolean {
    return true
  }

  isDestructive(_input: FileReadInput): boolean {
    return false
  }

  requiresApproval(_input: FileReadInput): boolean {
    return false
  }

  async call(input: FileReadInput, ctx: ToolContext): Promise<ToolResult> {
    const parsed = inputSchema.parse(input)
    const filePath = path.isAbsolute(parsed.path)
      ? parsed.path
      : path.join(ctx.workingDir, parsed.path)

    try {
      const text = await Bun.file(filePath).text()
      const lines = text.split('\n')

      const startLine = parsed.startLine ?? 1
      const endLine = parsed.endLine ?? lines.length

      if (startLine < 1 || endLine < startLine) {
        return {
          success: false,
          output: '',
          error: `Invalid line range: startLine=${startLine}, endLine=${endLine}`,
        }
      }

      // Slice is 0-indexed, lines are 1-indexed
      const sliced = lines.slice(startLine - 1, endLine)
      const formatted = formatWithLineNumbers(sliced, startLine)

      return {
        success: true,
        output: formatted,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const isNotFound =
        message.includes('ENOENT') || message.includes('No such file')
      return {
        success: false,
        output: '',
        error: isNotFound ? `File not found: ${filePath}` : message,
      }
    }
  }
}
