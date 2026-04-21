import type { MemoryProvider, HandoffFiles, MemorySearchResult } from './MemoryProvider.js'
import { MemoryStore } from '../store/MemoryStore.js'

/**
 * MarkdownMemoryProvider — the default backend.
 *
 * The agent already writes HANDOFF.md and MEMORY.md to the handoff directory
 * via the file_write tool. This provider is a no-op for onHandoffComplete —
 * the files are already where they need to be.
 *
 * store/get/search are backed by a file-based MemoryStore so they persist
 * across sessions.
 */
export class MarkdownMemoryProvider implements MemoryProvider {
  readonly backend = 'markdown' as const
  private _memStore: MemoryStore

  constructor(dataDir: string) {
    this._memStore = new MemoryStore(dataDir)
  }

  // No-op — agent already wrote the files
  async onHandoffComplete(_files: HandoffFiles): Promise<void> {
    // Files are at _files.transcriptPath and _files.memoryPath.
    // Nothing to do for markdown — they're already on disk.
  }

  async store(namespace: string, key: string, value: string, metadata?: Record<string, unknown>): Promise<void> {
    await this._memStore.set(namespace, key, value, metadata)
  }

  async get(namespace: string, key: string): Promise<string | null> {
    return this._memStore.get(namespace, key)
  }

  async search(namespace: string, query: string, limit = 10): Promise<MemorySearchResult[]> {
    return this._memStore.search(namespace, query, limit)
  }
}
