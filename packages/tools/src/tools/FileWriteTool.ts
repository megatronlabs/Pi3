import path from 'path'
import { z } from 'zod'
import { Tool, ToolContext, ToolResult } from '../types'

const inputSchema = z.object({
  path: z.string(),
  content: z.string(),
  createDirs: z.boolean().optional().default(true),
})

type FileWriteInput = z.input<typeof inputSchema>

export class FileWriteTool implements Tool<FileWriteInput, ToolResult> {
  name = 'file_write'
  description = 'Write or overwrite a file with the provided content'
  inputSchema = inputSchema

  isConcurrencySafe(_input: FileWriteInput): boolean {
    return false
  }

  isDestructive(_input: FileWriteInput): boolean {
    return true
  }

  requiresApproval(_input: FileWriteInput): boolean {
    return true
  }

  async call(input: FileWriteInput, ctx: ToolContext): Promise<ToolResult> {
    const parsed = inputSchema.parse(input)
    const filePath = path.isAbsolute(parsed.path)
      ? parsed.path
      : path.join(ctx.workingDir, parsed.path)

    try {
      if (parsed.createDirs) {
        const dir = path.dirname(filePath)
        const mkdirProc = Bun.spawn(['mkdir', '-p', dir], {
          stdout: 'pipe',
          stderr: 'pipe',
        })
        const exitCode = await mkdirProc.exited
        if (exitCode !== 0) {
          const stderr = await new Response(mkdirProc.stderr).text()
          return {
            success: false,
            output: '',
            error: `Failed to create directories: ${stderr}`,
          }
        }
      }

      await Bun.write(filePath, parsed.content)

      return {
        success: true,
        output: `Successfully wrote ${parsed.content.length} bytes to ${filePath}`,
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
