import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { ChildProcess } from 'node:child_process'
import type { McpServerConfig, McpTool, McpServerStatus } from './types.js'

export class McpClient {
  private _proc?: ChildProcess
  private _pending = new Map<number, { resolve: (r: unknown) => void; reject: (e: Error) => void }>()
  private _nextId = 1
  status: McpServerStatus = 'disconnected'
  tools: McpTool[] = []
  serverName?: string
  serverVersion?: string
  error?: string

  constructor(private config: McpServerConfig) {}

  get name(): string {
    return this.config.name
  }

  async connect(): Promise<void> {
    this.status = 'connecting'
    this._proc = spawn(this.config.command, this.config.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.config.env },
    })

    this._proc.on('error', (err) => {
      this.status = 'error'
      this.error = err.message
    })

    this._proc.on('exit', () => {
      this.status = 'disconnected'
    })

    // Read stdout line-by-line (each line is a JSON-RPC message)
    const rl = createInterface({ input: this._proc.stdout! })
    rl.on('line', (line) => {
      try {
        const msg = JSON.parse(line) as { id?: number; error?: { message?: string }; result?: unknown }
        if (msg.id !== undefined) {
          const pending = this._pending.get(msg.id)
          if (pending) {
            this._pending.delete(msg.id)
            if (msg.error) {
              pending.reject(new Error(msg.error.message ?? String(msg.error)))
            } else {
              pending.resolve(msg.result)
            }
          }
        }
        // Ignore notifications (no id) for now
      } catch {
        // ignore parse errors
      }
    })

    try {
      // initialize handshake
      const initResult = await this._request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'swarm', version: '0.1.0' },
      }) as { serverInfo?: { name?: string; version?: string } }

      this.serverName = initResult?.serverInfo?.name
      this.serverVersion = initResult?.serverInfo?.version

      // initialized notification (no response expected)
      this._notify('notifications/initialized', {})

      // discover tools
      const toolsResult = await this._request('tools/list', {}) as { tools?: McpTool[] }
      this.tools = toolsResult?.tools ?? []
      this.status = 'connected'
    } catch (err) {
      this.status = 'error'
      this.error = err instanceof Error ? err.message : String(err)
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this._request('tools/call', { name, arguments: args }) as {
      content?: Array<{ type: string; text?: string }>
      isError?: boolean
    }
    const text = result?.content
      ?.filter(c => c.type === 'text')
      .map(c => c.text ?? '')
      .join('\n') ?? ''
    if (result?.isError) throw new Error(text || 'MCP tool call failed')
    return text
  }

  disconnect(): void {
    this._proc?.kill()
    this.status = 'disconnected'
  }

  private _request(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this._nextId++
      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params })
      this._pending.set(id, { resolve, reject })
      this._proc?.stdin?.write(msg + '\n')
      // timeout after 10s
      setTimeout(() => {
        if (this._pending.has(id)) {
          this._pending.delete(id)
          reject(new Error(`MCP request "${method}" timed out`))
        }
      }, 10_000)
    })
  }

  private _notify(method: string, params: unknown): void {
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params })
    this._proc?.stdin?.write(msg + '\n')
  }
}
