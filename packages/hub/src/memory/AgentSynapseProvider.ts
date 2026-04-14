import { readFile } from 'node:fs/promises'
import type { MemoryProvider, HandoffFiles, MemorySearchResult } from './MemoryProvider.js'

/**
 * AgentSynapseProvider — stub for AgentSynapse / AgentCognose memory backend.
 *
 * NOT YET IMPLEMENTED. Logs a warning and falls back to no-op behavior.
 *
 * When AgentSynapse/AgentCognose source is integrated, this provider should:
 *
 *   onHandoffComplete:
 *     1. Read HANDOFF.md → POST to /store_memory with tag 'handoff' + sessionId
 *     2. Read MEMORY.md  → POST to /store_memory with tag 'memory' + project name
 *
 *   store:
 *     → POST /store_memory { content: value, project: namespace, tags: [key] }
 *
 *   get:
 *     → GET /get_memory { project: namespace, key: key }
 *
 *   search:
 *     → POST /search_memories { query, project: namespace, limit }
 *
 * The baseUrl and projectName are wired from config:
 *   memory.agentsynapse_url    (default http://localhost:8000)
 *   memory.agentsynapse_project
 */
export class AgentSynapseProvider implements MemoryProvider {
  readonly backend = 'agentsynapse' as const

  constructor(
    private baseUrl: string,
    private projectName: string,
  ) {}

  async onHandoffComplete(files: HandoffFiles): Promise<void> {
    // TODO: implement when AgentSynapse source is integrated
    // Placeholder: read files and log what would be stored
    try {
      const [transcript, memory] = await Promise.all([
        readFile(files.transcriptPath, 'utf8').catch(() => ''),
        readFile(files.memoryPath, 'utf8').catch(() => ''),
      ])

      // When implemented, these will be API calls:
      // await this._post('/store_memory', {
      //   content: transcript,
      //   project: this.projectName,
      //   tags: ['handoff', `session:${files.sessionId}`],
      // })
      // await this._post('/store_memory', {
      //   content: memory,
      //   project: this.projectName,
      //   tags: ['memory', `session:${files.sessionId}`],
      // })

      void transcript
      void memory
      process.stderr.write(
        `[AgentSynapseProvider] Handoff ready to sync to ${this.baseUrl} — ` +
        `integration pending (set memory.backend = "markdown" to suppress this)\n`,
      )
    } catch {
      // Silent — never crash the app for memory sync
    }
  }

  async store(_namespace: string, _key: string, _value: string): Promise<void> {
    // TODO: POST /store_memory
  }

  async get(_namespace: string, _key: string): Promise<string | null> {
    // TODO: GET /get_memory
    return null
  }

  async search(_namespace: string, _query: string, _limit?: number): Promise<MemorySearchResult[]> {
    // TODO: POST /search_memories
    return []
  }

  // ---------------------------------------------------------------------------
  // Private HTTP helper (used once implemented)
  // ---------------------------------------------------------------------------

  // private async _post(path: string, body: unknown): Promise<unknown> {
  //   const res = await fetch(`${this.baseUrl}${path}`, {
  //     method: 'POST',
  //     headers: { 'Content-Type': 'application/json' },
  //     body: JSON.stringify(body),
  //   })
  //   if (!res.ok) throw new Error(`AgentSynapse ${path} → ${res.status}`)
  //   return res.json()
  // }
}
