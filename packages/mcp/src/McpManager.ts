import { McpClient } from './McpClient.js'
import { McpAgentTool } from './McpAgentTool.js'
import type { McpServerConfig, McpServerInfo } from './types.js'

export class McpManager {
  private _clients: Map<string, McpClient> = new Map()

  async connectAll(servers: McpServerConfig[]): Promise<void> {
    const enabled = servers.filter(s => s.enabled)
    await Promise.allSettled(
      enabled.map(async (cfg) => {
        const client = new McpClient(cfg)
        this._clients.set(cfg.name, client)
        await client.connect()
      })
    )
  }

  getTools(): McpAgentTool[] {
    const tools: McpAgentTool[] = []
    for (const client of this._clients.values()) {
      if (client.status === 'connected') {
        for (const tool of client.tools) {
          tools.push(new McpAgentTool(client, tool))
        }
      }
    }
    return tools
  }

  getStatus(): McpServerInfo[] {
    return Array.from(this._clients.values()).map(c => ({
      name: c.name,
      status: c.status,
      toolCount: c.tools.length,
      error: c.error,
      serverName: c.serverName,
      serverVersion: c.serverVersion,
    }))
  }

  disconnectAll(): void {
    for (const client of this._clients.values()) {
      client.disconnect()
    }
  }
}
