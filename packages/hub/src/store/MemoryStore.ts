import { readFile, writeFile, rename, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MemoryEntry {
  value: string
  metadata: Record<string, unknown>
  updatedAt: string
}

export interface MemorySearchResult {
  key: string
  value: string
  namespace: string
  metadata?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Replace filesystem-unsafe characters so any string is a valid filename. */
function sanitize(s: string): string {
  return s.replace(/[/\\:*?"<>|\0]/g, '_')
}

// ---------------------------------------------------------------------------
// MemoryStore
// ---------------------------------------------------------------------------

/**
 * JSON-file-backed key-value store.
 *
 * Layout:
 *   <baseDir>/
 *     <namespace>/
 *       <key>.json   ← { value, metadata, updatedAt }
 *
 * All writes are atomic (temp → rename).
 */
export class MemoryStore {
  constructor(private readonly baseDir: string) {}

  async set(
    namespace: string,
    key: string,
    value: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    const dir = join(this.baseDir, sanitize(namespace))
    await mkdir(dir, { recursive: true })
    const filePath = join(dir, `${sanitize(key)}.json`)
    const tmpPath = `${filePath}.tmp`
    const entry: MemoryEntry = { value, metadata, updatedAt: new Date().toISOString() }
    await writeFile(tmpPath, JSON.stringify(entry, null, 2), 'utf8')
    await rename(tmpPath, filePath)
  }

  async get(namespace: string, key: string): Promise<string | null> {
    const filePath = join(this.baseDir, sanitize(namespace), `${sanitize(key)}.json`)
    try {
      const raw = await readFile(filePath, 'utf8')
      const entry = JSON.parse(raw) as MemoryEntry
      return entry.value
    } catch {
      return null
    }
  }

  async search(namespace: string, query: string, limit = 10): Promise<MemorySearchResult[]> {
    const dir = join(this.baseDir, sanitize(namespace))
    let files: string[]
    try {
      files = await readdir(dir)
    } catch {
      return []
    }

    const q = query.toLowerCase()
    const results: MemorySearchResult[] = []

    for (const file of files) {
      if (!file.endsWith('.json')) continue
      try {
        const raw = await readFile(join(dir, file), 'utf8')
        const entry = JSON.parse(raw) as MemoryEntry
        if (entry.value.toLowerCase().includes(q)) {
          results.push({
            key: file.slice(0, -5), // strip .json
            value: entry.value,
            namespace,
            metadata: entry.metadata,
          })
        }
      } catch {
        // skip corrupt files
      }
      if (results.length >= limit) break
    }

    return results
  }
}
