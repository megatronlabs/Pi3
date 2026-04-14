import { appendFile, readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeId(id: string): string {
  return id.replace(/[/\\:*?"<>|\0]/g, '_')
}

// ---------------------------------------------------------------------------
// SessionStore
// ---------------------------------------------------------------------------

/**
 * Append-only NDJSON store for chat session messages.
 *
 * Layout:
 *   <baseDir>/
 *     <sessionId>.ndjson   ← one message JSON per line
 */
export class SessionStore {
  constructor(private readonly baseDir: string) {}

  async append(sessionId: string, message: unknown): Promise<void> {
    await mkdir(this.baseDir, { recursive: true })
    const filePath = join(this.baseDir, `${sanitizeId(sessionId)}.ndjson`)
    await appendFile(filePath, JSON.stringify(message) + '\n', 'utf8')
  }

  async read(sessionId: string): Promise<unknown[]> {
    const filePath = join(this.baseDir, `${sanitizeId(sessionId)}.ndjson`)
    try {
      const raw = await readFile(filePath, 'utf8')
      return raw
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line) as unknown)
    } catch {
      return []
    }
  }
}
