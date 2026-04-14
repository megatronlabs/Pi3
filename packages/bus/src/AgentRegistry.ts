import { promises as fs } from 'fs'
import { dirname } from 'path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegistryEntry {
  id: string
  name: string
  model: string
  provider: string
  pid: number
  sessionId: string
  workingDir: string
  /** ISO 8601 — updated after each agent turn */
  lastActiveAt: string
  messageCount: number
  /** Computed on read from lastActiveAt — not stored in the file */
  status?: 'active' | 'idle' | 'away'
}

// Status thresholds
const ACTIVE_THRESHOLD_MS = 30_000          // < 30 s  → active
const IDLE_THRESHOLD_MS   = 5 * 60_000      // 30 s–5 min → idle; >5 min → away

function computeStatus(entry: Omit<RegistryEntry, 'status'>): 'active' | 'idle' | 'away' {
  const age = Date.now() - new Date(entry.lastActiveAt).getTime()
  if (age < ACTIVE_THRESHOLD_MS) return 'active'
  if (age < IDLE_THRESHOLD_MS)   return 'idle'
  return 'away'
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

type StoredMap = Record<string, Omit<RegistryEntry, 'status'>>

/**
 * AgentRegistry — single-file JSON registry of all running agents.
 *
 * Agents register on startup, update lastActiveAt after each turn,
 * and remove themselves on exit. Status is derived from lastActiveAt
 * at read time — no heartbeat required.
 *
 * All writes are atomic: written to a .tmp file then renamed into place,
 * preventing corruption from concurrent agent writes.
 */
export class AgentRegistry {
  constructor(private readonly registryPath: string) {}

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async register(entry: Omit<RegistryEntry, 'status'>): Promise<void> {
    const data = await this._read()
    data[entry.id] = entry
    await this._write(data)
  }

  async update(id: string, patch: Partial<Omit<RegistryEntry, 'status'>>): Promise<void> {
    const data = await this._read()
    if (data[id]) {
      data[id] = { ...data[id], ...patch }
      await this._write(data)
    }
  }

  /** Returns all registered agents with status computed from lastActiveAt. */
  async list(): Promise<RegistryEntry[]> {
    const data = await this._read()
    return Object.values(data).map(entry => ({
      ...entry,
      status: computeStatus(entry),
    }))
  }

  async remove(id: string): Promise<void> {
    const data = await this._read()
    delete data[id]
    await this._write(data)
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async _read(): Promise<StoredMap> {
    try {
      const raw = await fs.readFile(this.registryPath, 'utf8')
      return JSON.parse(raw) as StoredMap
    } catch {
      return {}
    }
  }

  private async _write(data: StoredMap): Promise<void> {
    const tmpPath = `${this.registryPath}.tmp`
    await fs.mkdir(dirname(this.registryPath), { recursive: true })
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8')
    await fs.rename(tmpPath, this.registryPath)
  }
}
