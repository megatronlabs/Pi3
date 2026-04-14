import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { MemoryStore } from './store/MemoryStore.js'
import { LogStore } from './store/LogStore.js'
import { SessionStore } from './store/SessionStore.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HubServerOpts {
  port: number
  /** Absolute path to the hub data directory, e.g. ~/.swarm/hub */
  dataDir: string
}

interface RegistryEntry {
  lastActiveAt: string
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACTIVE_MS = 30_000
const IDLE_MS   = 5 * 60_000

function computeStatus(lastActiveAt: string): 'active' | 'idle' | 'away' {
  const age = Date.now() - new Date(lastActiveAt).getTime()
  if (age < ACTIVE_MS) return 'active'
  if (age < IDLE_MS)   return 'idle'
  return 'away'
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ---------------------------------------------------------------------------
// HubServer
// ---------------------------------------------------------------------------

/**
 * HubServer — long-running local HTTP server providing four services:
 *   1. Memory backend  (store / get / search / handoff)
 *   2. OTLP log collector  (POST /v1/logs + GET /api/logs)
 *   3. Agent registry proxy  (GET /api/agents — reads registry.json, computes status)
 *   4. Chat session persistence  (GET/POST /api/sessions/:sessionId)
 *
 * Uses Bun.serve(). Zero external dependencies.
 * All hub errors are caught and logged to stderr — the host process never crashes.
 */
export class HubServer {
  private readonly _memory: MemoryStore
  private readonly _logs: LogStore
  private readonly _sessions: SessionStore
  /** ~/.swarm/agents/registry.json — derived from dataDir's parent */
  private readonly _registryPath: string
  private _server: ReturnType<typeof Bun.serve> | null = null
  private _startedAt = 0

  constructor(private readonly opts: HubServerOpts) {
    this._memory  = new MemoryStore(join(opts.dataDir, 'memory'))
    this._logs    = new LogStore(join(opts.dataDir, 'logs'))
    this._sessions = new SessionStore(join(opts.dataDir, 'sessions'))
    // registry.json lives at ~/.swarm/agents/ — one level above the hub data dir
    this._registryPath = join(dirname(opts.dataDir), 'agents', 'registry.json')
  }

  async start(): Promise<void> {
    this._startedAt = Date.now()
    this._server = Bun.serve({
      port: this.opts.port,
      fetch: (req: Request) => this._handle(req).catch(err => {
        process.stderr.write(`[HubServer] Unhandled error: ${err}\n`)
        return json({ error: 'internal error' }, 500)
      }),
    })
    process.stderr.write(`[HubServer] Listening on port ${this.opts.port}\n`)
  }

  async stop(): Promise<void> {
    this._server?.stop()
    this._server = null
  }

  // ---------------------------------------------------------------------------
  // Request router
  // ---------------------------------------------------------------------------

  private async _handle(req: Request): Promise<Response> {
    const url    = new URL(req.url)
    const path   = url.pathname
    const method = req.method

    // GET /health
    if (method === 'GET' && path === '/health') {
      return json({ status: 'ok', uptime: Date.now() - this._startedAt })
    }

    // POST /v1/logs  — OTLP receiver
    if (method === 'POST' && path === '/v1/logs') {
      const body = await req.json()
      await this._logs.appendOtlp(body)
      return json({ ok: true })
    }

    // GET /api/logs  — query stored logs
    if (method === 'GET' && path === '/api/logs') {
      const since   = url.searchParams.get('since')   ?? undefined
      const traceId = url.searchParams.get('traceId') ?? undefined
      const agentId = url.searchParams.get('agentId') ?? undefined
      const limitRaw = url.searchParams.get('limit')
      const limit = limitRaw ? Number(limitRaw) : undefined
      const records = await this._logs.query({ since, traceId, agentId, limit })
      return json(records)
    }

    // POST /api/memory/store
    if (method === 'POST' && path === '/api/memory/store') {
      const body = (await req.json()) as {
        namespace: string
        key: string
        value: string
        metadata?: Record<string, unknown>
      }
      await this._memory.set(body.namespace, body.key, body.value, body.metadata)
      return json({ ok: true })
    }

    // POST /api/memory/search
    if (method === 'POST' && path === '/api/memory/search') {
      const body = (await req.json()) as { namespace: string; query: string; limit?: number }
      const results = await this._memory.search(body.namespace, body.query, body.limit)
      return json(results)
    }

    // POST /api/memory/handoff
    if (method === 'POST' && path === '/api/memory/handoff') {
      const body = (await req.json()) as {
        transcriptPath: string
        memoryPath: string
        sessionId: string
      }
      const [transcript, memory] = await Promise.all([
        readFile(body.transcriptPath, 'utf8').catch(() => ''),
        readFile(body.memoryPath, 'utf8').catch(() => ''),
      ])
      if (transcript) await this._memory.set(body.sessionId, 'handoff_transcript', transcript)
      if (memory)     await this._memory.set(body.sessionId, 'handoff_memory', memory)
      return json({ ok: true })
    }

    // GET /api/memory/:namespace/:key  — must come after the named /memory/* routes
    const memMatch = path.match(/^\/api\/memory\/([^/]+)\/(.+)$/)
    if (method === 'GET' && memMatch) {
      const [, ns, key] = memMatch as [string, string, string]
      const value = await this._memory.get(ns, key)
      if (value === null) return json({ error: 'not found' }, 404)
      return json({ value })
    }

    // GET /api/agents  — read registry.json, compute status
    if (method === 'GET' && path === '/api/agents') {
      try {
        const raw = await readFile(this._registryPath, 'utf8')
        const data = JSON.parse(raw) as Record<string, RegistryEntry>
        const agents = Object.values(data).map(entry => ({
          ...entry,
          status: computeStatus(entry.lastActiveAt),
        }))
        return json(agents)
      } catch {
        return json([])
      }
    }

    // GET /api/sessions/:sessionId  and  POST /api/sessions/:sessionId
    const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)$/)
    if (sessionMatch) {
      const [, sessionId] = sessionMatch as [string, string]
      if (method === 'GET') {
        const messages = await this._sessions.read(sessionId)
        return json(messages)
      }
      if (method === 'POST') {
        const message = await req.json()
        await this._sessions.append(sessionId, message)
        return json({ ok: true })
      }
    }

    return json({ error: 'not found' }, 404)
  }
}
