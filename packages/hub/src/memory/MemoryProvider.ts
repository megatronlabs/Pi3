import { homedir } from 'node:os'

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/**
 * The two files the agent writes during a handoff.
 * Always lives at memory.path (default ~/.swarm/handoff/).
 */
export interface HandoffFiles {
  /** Absolute path to HANDOFF.md (session transcript) */
  transcriptPath: string
  /** Absolute path to MEMORY.md (durable facts) */
  memoryPath: string
  /** When the handoff was triggered */
  timestamp: Date
  sessionId: string
  /** Context % that triggered the handoff */
  contextPct: number
}

export interface MemorySearchResult {
  key: string
  value: string
  namespace: string
  score?: number
  metadata?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

/**
 * MemoryProvider — pluggable backend for agent memory.
 *
 * Implementations:
 *   MarkdownMemoryProvider   — files in ~/.swarm/handoff/ (default, already works)
 *   ObsidianMemoryProvider   — same files, copied into an Obsidian vault
 *   AgentSynapseProvider     — stub; routes to AgentSynapse at localhost:8000
 *   AgentCognoseProvider     — stub; routes to AgentCognose when available
 *
 * The handoff flow:
 *   1. Agent writes HANDOFF.md + MEMORY.md via file_write tool (always)
 *   2. After agent finishes, App calls provider.onHandoffComplete(files)
 *   3. Provider does whatever the backend requires (no-op, copy, API call, etc.)
 */
export interface MemoryProvider {
  readonly backend: MemoryBackend

  /**
   * Called after the agent successfully writes the handoff files.
   * The files already exist on disk at files.transcriptPath / files.memoryPath.
   * Implementations sync them to their backend if needed.
   */
  onHandoffComplete(files: HandoffFiles): Promise<void>

  // -------------------------------------------------------------------------
  // Future: general-purpose KV + search (stub with notImplemented for now)
  // -------------------------------------------------------------------------

  /** Write a value into a namespace */
  store(namespace: string, key: string, value: string, metadata?: Record<string, unknown>): Promise<void>

  /** Read a value; returns null if not found */
  get(namespace: string, key: string): Promise<string | null>

  /**
   * Semantic search within a namespace.
   * Falls back to substring match for backends without embeddings.
   */
  search(namespace: string, query: string, limit?: number): Promise<MemorySearchResult[]>
}

// ---------------------------------------------------------------------------
// Backend discriminant (matches config values)
// ---------------------------------------------------------------------------

export type MemoryBackend = 'markdown' | 'obsidian' | 'agentsynapse' | 'agentcognose'

// ---------------------------------------------------------------------------
// Shared helper — expand ~ in paths
// ---------------------------------------------------------------------------

export function expandPath(p: string): string {
  return p.startsWith('~') ? homedir() + p.slice(1) : p
}
