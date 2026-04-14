import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StoredLogRecord {
  timestamp: number                                    // unix ms
  date: string                                         // YYYY-MM-DD
  severityText: string
  body: string
  traceId: string
  spanId: string
  attributes: Record<string, string | number | boolean>
}

export interface LogQuery {
  since?: string    // ISO date string — filter records with timestamp >= this
  traceId?: string
  agentId?: string  // matches attributes['agent.id']
  limit?: number
}

// ---------------------------------------------------------------------------
// OTLP payload shape (subset we care about)
// ---------------------------------------------------------------------------

interface OtlpAttribute {
  key: string
  value: { stringValue?: string; intValue?: number }
}

interface OtlpLogRecord {
  timeUnixNano?: string
  severityText?: string
  body?: { stringValue?: string }
  traceId?: string
  spanId?: string
  attributes?: OtlpAttribute[]
}

interface OtlpScopeLog {
  logRecords?: OtlpLogRecord[]
}

interface OtlpResourceLog {
  scopeLogs?: OtlpScopeLog[]
}

interface OtlpPayload {
  resourceLogs?: OtlpResourceLog[]
}

// ---------------------------------------------------------------------------
// LogStore
// ---------------------------------------------------------------------------

/**
 * Append-only NDJSON log store, one file per calendar day.
 *
 * Layout:
 *   <baseDir>/
 *     <YYYY-MM-DD>.ndjson   ← one StoredLogRecord JSON per line
 */
export class LogStore {
  constructor(private readonly baseDir: string) {}

  /** Receive an OTLP JSON payload, extract records, append to today's file. */
  async appendOtlp(payload: unknown): Promise<void> {
    try {
      await mkdir(this.baseDir, { recursive: true })
      const records = this._extract(payload as OtlpPayload)
      if (records.length === 0) return

      // Group by date to handle payloads with records spanning midnight
      const byDate = new Map<string, StoredLogRecord[]>()
      for (const r of records) {
        const bucket = byDate.get(r.date) ?? []
        bucket.push(r)
        byDate.set(r.date, bucket)
      }

      await Promise.all(
        Array.from(byDate.entries()).map(([date, recs]) => {
          const filePath = join(this.baseDir, `${date}.ndjson`)
          const lines = recs.map(r => JSON.stringify(r)).join('\n') + '\n'
          return appendFile(filePath, lines, 'utf8')
        }),
      )
    } catch (err) {
      process.stderr.write(`[LogStore] appendOtlp error: ${err}\n`)
    }
  }

  async query({ since, traceId, agentId, limit = 100 }: LogQuery): Promise<StoredLogRecord[]> {
    let files: string[]
    try {
      files = await readdir(this.baseDir)
    } catch {
      return []
    }

    // Only .ndjson files, sorted ascending by date
    const dateFiles = files.filter(f => f.endsWith('.ndjson')).sort()

    // Skip files older than `since`
    const sinceDate = since ? new Date(since).toISOString().slice(0, 10) : undefined
    const relevant = sinceDate ? dateFiles.filter(f => f.slice(0, 10) >= sinceDate) : dateFiles
    const sinceMs = since ? new Date(since).getTime() : 0

    const results: StoredLogRecord[] = []

    for (const file of relevant) {
      if (results.length >= limit) break
      try {
        const raw = await readFile(join(this.baseDir, file), 'utf8')
        for (const line of raw.split('\n')) {
          if (!line.trim()) continue
          if (results.length >= limit) break
          try {
            const r = JSON.parse(line) as StoredLogRecord
            if (sinceMs && r.timestamp < sinceMs) continue
            if (traceId && r.traceId !== traceId) continue
            if (agentId && r.attributes['agent.id'] !== agentId) continue
            results.push(r)
          } catch {
            // skip corrupt lines
          }
        }
      } catch {
        // skip unreadable files
      }
    }

    return results
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private _extract(payload: OtlpPayload): StoredLogRecord[] {
    const records: StoredLogRecord[] = []
    for (const rl of payload.resourceLogs ?? []) {
      for (const sl of rl.scopeLogs ?? []) {
        for (const lr of sl.logRecords ?? []) {
          // timeUnixNano is a string to avoid JS precision loss on large ints
          const tsMs = lr.timeUnixNano
            ? Number(BigInt(lr.timeUnixNano) / BigInt(1_000_000))
            : Date.now()
          const date = new Date(tsMs).toISOString().slice(0, 10)

          const attrs: Record<string, string | number | boolean> = {}
          for (const a of lr.attributes ?? []) {
            if (a.value.stringValue !== undefined) attrs[a.key] = a.value.stringValue
            else if (a.value.intValue !== undefined) attrs[a.key] = a.value.intValue
          }

          records.push({
            timestamp: tsMs,
            date,
            severityText: lr.severityText ?? 'INFO',
            body: lr.body?.stringValue ?? '',
            traceId: lr.traceId ?? '',
            spanId: lr.spanId ?? '',
            attributes: attrs,
          })
        }
      }
    }
    return records
  }
}
