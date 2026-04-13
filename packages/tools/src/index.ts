export type { Tool, ToolContext, ToolResult } from './types'
export { BashTool } from './tools/BashTool'
export { FileReadTool } from './tools/FileReadTool'
export { FileWriteTool } from './tools/FileWriteTool'
export { FileEditTool } from './tools/FileEditTool'
export { GlobTool } from './tools/GlobTool'
export { GrepTool } from './tools/GrepTool'

import type { Tool } from './types'
import { BashTool } from './tools/BashTool'
import { FileReadTool } from './tools/FileReadTool'
import { FileWriteTool } from './tools/FileWriteTool'
import { FileEditTool } from './tools/FileEditTool'
import { GlobTool } from './tools/GlobTool'
import { GrepTool } from './tools/GrepTool'

// Convenience: all default tool instances
export const defaultTools: Tool[] = [
  new BashTool(),
  new FileReadTool(),
  new FileWriteTool(),
  new FileEditTool(),
  new GlobTool(),
  new GrepTool(),
]
