export interface McpServerConfig {
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  enabled: boolean
}

export interface McpToolSchema {
  type: 'object'
  properties?: Record<string, unknown>
  required?: string[]
}

export interface McpTool {
  name: string
  description?: string
  inputSchema: McpToolSchema
}

export type McpServerStatus = 'connecting' | 'connected' | 'error' | 'disconnected'

export interface McpServerInfo {
  name: string
  status: McpServerStatus
  toolCount: number
  error?: string
  serverName?: string
  serverVersion?: string
}
