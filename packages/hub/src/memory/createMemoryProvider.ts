import { expandPath } from './MemoryProvider.js'
import { MarkdownMemoryProvider } from './MarkdownMemoryProvider.js'
import { ObsidianMemoryProvider } from './ObsidianMemoryProvider.js'
import { AgentSynapseProvider } from './AgentSynapseProvider.js'
import { HubMemoryProvider } from '../HubMemoryProvider.js'
import type { MemoryProvider, MemoryBackend } from './MemoryProvider.js'

export interface MemoryConfig {
  backend: MemoryBackend
  /** Base path for handoff files (markdown / obsidian source). Default ~/.swarm/handoff */
  path?: string
  /** Obsidian vault path — required when backend = 'obsidian' */
  obsidian_vault?: string
  /** AgentSynapse / AgentCognose base URL */
  agentsynapse_url?: string
  /** Project name used when storing memories in AgentSynapse */
  agentsynapse_project?: string
  /** Context % that triggers the handoff write. Range 80–95, default 85 */
  context_threshold?: number
}

export function createMemoryProvider(cfg: MemoryConfig): MemoryProvider {
  switch (cfg.backend) {
    case 'markdown':
      return new MarkdownMemoryProvider()

    case 'obsidian': {
      const vault = cfg.obsidian_vault
      if (!vault) {
        process.stderr.write(
          '[swarm] memory.backend = "obsidian" but memory.obsidian_vault is not set — falling back to markdown\n',
        )
        return new MarkdownMemoryProvider()
      }
      return new ObsidianMemoryProvider(expandPath(vault))
    }

    case 'agentsynapse':
      return new HubMemoryProvider(
        cfg.agentsynapse_url ?? 'http://localhost:7777',
        cfg.agentsynapse_project ?? 'swarm',
      )

    case 'agentcognose':
      return new AgentSynapseProvider(
        cfg.agentsynapse_url ?? 'http://localhost:8000',
        cfg.agentsynapse_project ?? 'swarm',
      )

    default:
      return new MarkdownMemoryProvider()
  }
}
