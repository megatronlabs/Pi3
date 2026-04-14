import { copyFile, mkdir } from 'node:fs/promises'
import { join, basename } from 'node:path'
import type { MemoryProvider, HandoffFiles, MemorySearchResult } from './MemoryProvider.js'
import { expandPath } from './MemoryProvider.js'

/**
 * ObsidianMemoryProvider — writes handoff files into an Obsidian vault.
 *
 * Files are copied to:
 *   <vault>/Swarm/Sessions/<sessionId>/HANDOFF.md
 *   <vault>/Swarm/Sessions/<sessionId>/MEMORY.md
 *
 * Obsidian picks them up on next vault reload. No plugin required.
 *
 * store/get/search are in-memory placeholders (same as MarkdownMemoryProvider)
 * until the hub server is built with vault-backed persistence.
 */
export class ObsidianMemoryProvider implements MemoryProvider {
  readonly backend = 'obsidian' as const

  private _store = new Map<string, string>()

  constructor(private vaultPath: string) {
    this.vaultPath = expandPath(vaultPath)
  }

  async onHandoffComplete(files: HandoffFiles): Promise<void> {
    const destDir = join(
      this.vaultPath,
      'Swarm',
      'Sessions',
      files.sessionId,
    )

    await mkdir(destDir, { recursive: true })

    await Promise.all([
      copyFile(files.transcriptPath, join(destDir, basename(files.transcriptPath))),
      copyFile(files.memoryPath,     join(destDir, basename(files.memoryPath))),
    ])
  }

  async store(namespace: string, key: string, value: string): Promise<void> {
    this._store.set(`${namespace}::${key}`, value)
  }

  async get(namespace: string, key: string): Promise<string | null> {
    return this._store.get(`${namespace}::${key}`) ?? null
  }

  async search(namespace: string, query: string, limit = 10): Promise<MemorySearchResult[]> {
    const results: MemorySearchResult[] = []
    const prefix = `${namespace}::`
    const q = query.toLowerCase()

    for (const [k, v] of this._store) {
      if (!k.startsWith(prefix)) continue
      if (v.toLowerCase().includes(q)) {
        results.push({ key: k.slice(prefix.length), value: v, namespace })
      }
      if (results.length >= limit) break
    }

    return results
  }
}
