import type { MemoryProvider, HandoffFiles, MemorySearchResult } from './memory/MemoryProvider.js'

/**
 * HubMemoryProvider — MemoryProvider implementation backed by the local Hub server.
 *
 * Makes HTTP calls to the hub at baseUrl. All methods are fire-and-forget safe —
 * network errors are caught and swallowed so the app never crashes for memory ops.
 *
 * Used when config.memory.backend = 'agentsynapse' and the hub is running locally.
 */
export class HubMemoryProvider implements MemoryProvider {
  readonly backend = 'agentsynapse' as const

  constructor(
    private readonly baseUrl: string,
    private readonly projectName: string,
  ) {}

  async onHandoffComplete(files: HandoffFiles): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/api/memory/handoff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcriptPath: files.transcriptPath,
          memoryPath: files.memoryPath,
          sessionId: files.sessionId,
        }),
      })
    } catch {
      // Never crash the app for memory sync
    }
  }

  async store(
    namespace: string,
    key: string,
    value: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/api/memory/store`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ namespace, key, value, metadata }),
      })
    } catch {
      // Never crash the app
    }
  }

  async get(namespace: string, key: string): Promise<string | null> {
    try {
      const res = await fetch(
        `${this.baseUrl}/api/memory/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`,
      )
      if (!res.ok) return null
      const data = (await res.json()) as { value?: string }
      return data.value ?? null
    } catch {
      return null
    }
  }

  async search(namespace: string, query: string, limit?: number): Promise<MemorySearchResult[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/memory/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ namespace, query, limit }),
      })
      if (!res.ok) return []
      return (await res.json()) as MemorySearchResult[]
    } catch {
      return []
    }
  }
}
