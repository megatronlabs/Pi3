import type { SwarmConfig, RoleName, RoleAssignment, PartialRoleMap } from './schema.js'

// ---------------------------------------------------------------------------
// Built-in presets — available without any config file
// ---------------------------------------------------------------------------

export const BUILT_IN_PRESETS: Record<string, PartialRoleMap> = {
  /** Best-in-class cloud models per role */
  quality: {
    chat:          { model: 'claude-sonnet-4-6',          provider: 'anthropic' },
    coding:        { model: 'claude-sonnet-4-6',          provider: 'anthropic' },
    planning:      { model: 'claude-opus-4-6',            provider: 'anthropic' },
    reasoning:     { model: 'claude-opus-4-6',            provider: 'anthropic' },
    orchestration: { model: 'claude-haiku-4-5-20251001',  provider: 'anthropic' },
    summarization: { model: 'claude-haiku-4-5-20251001',  provider: 'anthropic' },
    image:         { model: 'black-forest-labs/flux-schnell', provider: 'replicate' },
    video:         { model: 'minimax/video-01',           provider: 'replicate' },
    search:        { model: 'claude-sonnet-4-6',          provider: 'anthropic' },
  },

  /** Fastest / cheapest cloud models */
  fast: {
    chat:          { model: 'claude-haiku-4-5-20251001',  provider: 'anthropic' },
    coding:        { model: 'claude-haiku-4-5-20251001',  provider: 'anthropic' },
    planning:      { model: 'claude-sonnet-4-6',          provider: 'anthropic' },
    reasoning:     { model: 'claude-sonnet-4-6',          provider: 'anthropic' },
    orchestration: { model: 'claude-haiku-4-5-20251001',  provider: 'anthropic' },
    summarization: { model: 'claude-haiku-4-5-20251001',  provider: 'anthropic' },
    image:         { model: 'black-forest-labs/flux-schnell', provider: 'replicate' },
    video:         { model: 'minimax/video-01',           provider: 'replicate' },
    search:        { model: 'claude-haiku-4-5-20251001',  provider: 'anthropic' },
  },

  /** Fully local — all roles use Ollama */
  local: {
    chat:          { model: 'qwen2.5:7b',      provider: 'ollama' },
    coding:        { model: 'qwen2.5:14b',     provider: 'ollama' },
    planning:      { model: 'qwen2.5:7b',      provider: 'ollama' },
    reasoning:     { model: 'deepseek-r1:7b',  provider: 'ollama' },
    orchestration: { model: 'qwen2.5:3b',      provider: 'ollama' },
    summarization: { model: 'qwen2.5:3b',      provider: 'ollama' },
    search:        { model: 'qwen2.5:7b',      provider: 'ollama' },
  },

  /** Local for chat/orchestration, cloud for coding/planning/reasoning */
  mixed: {
    chat:          { model: 'qwen2.5:7b',             provider: 'ollama' },
    coding:        { model: 'claude-sonnet-4-6',       provider: 'anthropic' },
    planning:      { model: 'claude-opus-4-6',         provider: 'anthropic' },
    reasoning:     { model: 'deepseek-r1:14b',         provider: 'ollama' },
    orchestration: { model: 'qwen2.5:3b',             provider: 'ollama' },
    summarization: { model: 'claude-haiku-4-5-20251001', provider: 'anthropic' },
    image:         { model: 'black-forest-labs/flux-schnell', provider: 'replicate' },
    video:         { model: 'minimax/video-01',        provider: 'replicate' },
    search:        { model: 'claude-sonnet-4-6',       provider: 'anthropic' },
  },
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Resolve the model + provider for a given role, using this priority:
 *   1. User-defined preset (from config [presets.<name>])
 *   2. Built-in preset (BUILT_IN_PRESETS)
 *   3. User-defined [roles] section (config.roles)
 *   4. config.defaults.model / config.defaults.provider
 */
export function resolveRole(
  config: SwarmConfig,
  role: RoleName,
  presetOverride?: string,
): RoleAssignment {
  const presetName = presetOverride ?? config.defaults.preset ?? 'default'

  // 1. User-defined preset in config file
  if (presetName !== 'default') {
    const userPreset = config.presets[presetName]
    if (userPreset?.[role]) return userPreset[role]!

    // 2. Built-in preset
    const builtIn = BUILT_IN_PRESETS[presetName]
    if (builtIn?.[role]) return builtIn[role]!
  }

  // 3. Direct [roles] section
  const direct = config.roles[role]
  if (direct) return direct

  // 4. Fall back to defaults
  return { model: config.defaults.model, provider: config.defaults.provider }
}

/**
 * Return a full role map for the active preset — every role resolved.
 */
export function resolveAllRoles(
  config: SwarmConfig,
  presetOverride?: string,
): Record<RoleName, RoleAssignment> {
  const roles: Partial<Record<RoleName, RoleAssignment>> = {}
  const roleNames: RoleName[] = [
    'chat', 'coding', 'planning', 'reasoning',
    'orchestration', 'image', 'video', 'summarization', 'search',
  ]
  for (const role of roleNames) {
    roles[role] = resolveRole(config, role, presetOverride)
  }
  return roles as Record<RoleName, RoleAssignment>
}

/**
 * List all preset names: built-ins + any user-defined ones.
 */
export function listPresets(config: SwarmConfig): string[] {
  const names = new Set(['default', ...Object.keys(BUILT_IN_PRESETS)])
  for (const name of Object.keys(config.presets)) names.add(name)
  return [...names]
}
