import { readFile } from 'node:fs/promises'
import type { MemoryProvider, HandoffFiles, MemorySearchResult } from './MemoryProvider.js'

/**
 * AgentSynapseProvider — MemoryProvider backed by the Hub server's memory API.
 *
 * Used when config.memory.backend = 'agentcognose'. Routes to agentsynapse_url
 * (default http://localhost:8000 — the external AgentSynapse / Pi3 hub instance).
 *
 * All methods call the hub's /api/memory/* endpoints. Network errors are caught
 * and swallowed — the app never crashes for memory sync failures.
 */
export class AgentSynapseProvider implements MemoryProvider {
  readonly backend = 'agentcognose' as const

  constructor(
    private readonly baseUrl: string,
    private readonly projectName: string,
  ) {}

  async onHandoffComplete(files: HandoffFiles): Promise<void> {
    try {
      // Read the files so we can also store their content in the hub for
      // searchability, in addition to the file-path handoff call.
      const [, memory] = await Promise.all([
        readFile(files.transcriptPath, 'utf8').catch(() => ''),
        readFile(files.memoryPath, 'utf8').catch(() => ''),
      ])

      // POST the file paths to the hub's handoff endpoint — hub reads and stores them.
      await fetch(`${this.baseUrl}/api/memory/handoff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcriptPath: files.transcriptPath,
          memoryPath:     files.memoryPath,
          sessionId:      files.sessionId,
        }),
      })

      // Also store the MEMORY.md content under the project namespace so it's
      // searchable via memory_search across sessions.
      if (memory) {
        await this.store(
          this.projectName,
          `memory:${files.sessionId}`,
          memory,
          { sessionId: files.sessionId, workingDir: files.workingDir },
        )
      }
    } catch {
      // Never crash the app for memory sync failures
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
