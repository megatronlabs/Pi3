import path from 'path'
import type { AgentTool } from '@swarm/orchestrator'

const WRITE_TOOLS = new Set(['file_write', 'file_edit'])

/**
 * Extracts the file/directory path from a tool's input, if any.
 */
function extractFilePath(toolName: string, input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const inp = input as Record<string, unknown>
  // All file tools and glob/grep use 'path' as the key
  if (typeof inp['path'] === 'string') return inp['path']
  return null
}

/**
 * Returns true if `target` is within `root` (or is root itself).
 */
function isWithinDir(target: string, root: string): boolean {
  const rel = path.relative(root, target)
  return !rel.startsWith('..') && !path.isAbsolute(rel)
}

export interface TrainingWheelsOpts {
  /** Returns true if the user has granted a one-time write pass */
  isWriteApproved(): boolean
  /** Called after a write pass is consumed */
  consumeWriteApproval(): void
}

/**
 * Wraps a tool list with training wheels restrictions:
 *  - bash is removed entirely
 *  - all file paths must be within workingDir
 *  - writes are blocked unless a write pass has been granted
 */
export function wrapWithTrainingWheels(
  tools: AgentTool[],
  workingDir: string,
  opts: TrainingWheelsOpts,
): AgentTool[] {
  return tools
    .filter(t => t.name !== 'bash')
    .map(tool => {
      const isWrite = WRITE_TOOLS.has(tool.name)

      return {
        ...tool,
        call: async (input: unknown, ctx: { workingDir: string; abortSignal?: AbortSignal }) => {
          // --- Path containment check ---
          const filePath = extractFilePath(tool.name, input)
          if (filePath) {
            const resolved = path.isAbsolute(filePath)
              ? filePath
              : path.join(ctx.workingDir, filePath)

            if (!isWithinDir(resolved, workingDir)) {
              return {
                success: false,
                output: '',
                error:
                  `[Training Wheels] Access denied: "${filePath}" is outside the working directory (${workingDir}). ` +
                  `Only files within this directory are accessible.`,
              }
            }
          }

          // --- Write approval check ---
          if (isWrite) {
            if (!opts.isWriteApproved()) {
              return {
                success: false,
                output: '',
                error:
                  `[Training Wheels] Write blocked for "${filePath ?? 'this file'}". ` +
                  `You must ask the user for permission. Say: "I need to write to ${filePath ?? 'this file'}. Can I?" ` +
                  `Once they approve, try again.`,
              }
            }
            // Consume the one-time pass before executing
            opts.consumeWriteApproval()
          }

          return tool.call(input as never, ctx)
        },
      }
    })
}

/** Approval keywords — if user message contains any of these, grant a write pass */
const APPROVAL_PATTERNS = [
  /\byes\b/i,
  /\bgo ahead\b/i,
  /\ballow\b/i,
  /\bpermission\b/i,
  /\bproceed\b/i,
  /\bwrite it\b/i,
  /\bdo it\b/i,
  /\bok\b/i,
  /\bsure\b/i,
]

export function messageGrantsWriteApproval(message: string): boolean {
  return APPROVAL_PATTERNS.some(p => p.test(message))
}
