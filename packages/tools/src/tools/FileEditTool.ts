import path from 'path'
import { z } from 'zod'
import { Tool, ToolContext, ToolResult } from '../types'

const inputSchema = z.object({
  path: z.string(),
  oldString: z.string(),
  newString: z.string(),
  replaceAll: z.boolean().optional().default(false),
})

type FileEditInput = z.input<typeof inputSchema>

export class FileEditTool implements Tool<FileEditInput, ToolResult> {
  name = 'file_edit'
  description =
    'Perform a surgical string replacement within a file (exact match required)'
  inputSchema = inputSchema

  isConcurrencySafe(_input: FileEditInput): boolean {
    return false
  }

  isDestructive(_input: FileEditInput): boolean {
    return true
  }

  requiresApproval(_input: FileEditInput): boolean {
    return true
  }

  async call(input: FileEditInput, ctx: ToolContext): Promise<ToolResult> {
    const parsed = inputSchema.parse(input)
    const filePath = path.isAbsolute(parsed.path)
      ? parsed.path
      : path.join(ctx.workingDir, parsed.path)

    try {
      const text = await Bun.file(filePath).text()

      const occurrences = text.split(parsed.oldString).length - 1

      if (occurrences === 0) {
        return {
          success: false,
          output: '',
          error: `String not found in file: ${filePath}`,
        }
      }

      if (!parsed.replaceAll && occurrences > 1) {
        return {
          success: false,
          output: '',
          error: `Ambiguous replacement: oldString appears ${occurrences} times in ${filePath}. Use replaceAll=true or provide a more specific string.`,
        }
      }

      let newText: string
      if (parsed.replaceAll) {
        newText = text.split(parsed.oldString).join(parsed.newString)
      } else {
        // Replace only the first occurrence
        newText = text.replace(parsed.oldString, parsed.newString)
      }

      await Bun.write(filePath, newText)

      const count = parsed.replaceAll ? occurrences : 1
      return {
        success: true,
        output: `Replaced ${count} occurrence(s) in ${filePath}`,
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
