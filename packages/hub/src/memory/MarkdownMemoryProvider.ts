import type { MemoryProvider, HandoffFiles, MemorySearchResult } from './MemoryProvider.js'

/**
 * MarkdownMemoryProvider — the default backend.
 *
 * The agent already writes HANDOFF.md and MEMORY.md to the handoff directory
 * via the file_write tool. This provider is a no-op for onHandoffComplete —
 * the files are already where they need to be.
 *
 * store/get/search operate on an in-memory map (not persisted — these are
 * placeholders until the hub server is built).
 */
export class MarkdownMemoryProvider implements MemoryProvider {
  readonly backend = 'markdown' as const

  private _store = new Map<string, string>()

  // No-op — agent already wrote the files
  async onHandoffComplete(_files: HandoffFiles): Promise<void> {
    // Files are at _files.transcriptPath and _files.memoryPath.
    // Nothing to do for markdown — they're already on disk.
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
