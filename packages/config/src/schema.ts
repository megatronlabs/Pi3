import { z } from 'zod'

const ProviderConfigSchema = z.object({
  api_key: z.string().optional(),
  base_url: z.string().optional(),
})

/** A single role → model/provider assignment */
export const RoleAssignmentSchema = z.object({
  model: z.string(),
  provider: z.string(),
})
export type RoleAssignment = z.infer<typeof RoleAssignmentSchema>

/** All configurable roles */
export const ROLE_NAMES = [
  'chat',
  'coding',
  'planning',
  'reasoning',
  'orchestration',
  'image',
  'video',
  'summarization',
  'search',
] as const
export type RoleName = typeof ROLE_NAMES[number]

/** A full or partial role map — presets can omit roles they don't override */
const PartialRoleMapSchema = z.object({
  chat:           RoleAssignmentSchema.optional(),
  coding:         RoleAssignmentSchema.optional(),
  planning:       RoleAssignmentSchema.optional(),
  reasoning:      RoleAssignmentSchema.optional(),
  orchestration:  RoleAssignmentSchema.optional(),
  image:          RoleAssignmentSchema.optional(),
  video:          RoleAssignmentSchema.optional(),
  summarization:  RoleAssignmentSchema.optional(),
  search:         RoleAssignmentSchema.optional(),
}).default({})
export type PartialRoleMap = z.infer<typeof PartialRoleMapSchema>

export const ConfigSchema = z.object({
  defaults: z.object({
    model: z.string().default('claude-opus-4-6'),
    provider: z.string().default('anthropic'),
    theme: z.enum(['dark']).default('dark'),
    working_dir: z.string().optional(),
    /** Active preset name — 'default' means use [roles] section directly */
    preset: z.string().default('default'),
  }).default({}),

  /** Direct role overrides — used when preset is 'default' */
  roles: PartialRoleMapSchema,

  /** Named presets — each maps roles to model/provider pairs */
  presets: z.record(z.string(), PartialRoleMapSchema).default({}),

  providers: z.object({
    anthropic: ProviderConfigSchema.default({}),
    openrouter: ProviderConfigSchema.default({}),
    ollama: ProviderConfigSchema.extend({
      base_url: z.string().default('http://localhost:11434'),
    }).default({}),
    replicate: ProviderConfigSchema.default({}),
  }).default({}),

  tools: z.object({
    approval_required: z.array(z.string()).default([]),
    denied_commands: z.array(z.string()).default([]),
  }).default({}),

  communication: z.object({
    /**
     * hermes  — Hermes XML messages (fewer tokens, faster; best for 7B+ and API models)
     * english — Natural language prose (more readable; better for small local models <4B)
     */
    format: z.enum(['hermes', 'english']).default('hermes'),
    /**
     * orchestrated  — central orchestrator directs agents; agents report up
     * choreographed — pre-defined pipeline; each agent passes work to the next
     * adhoc         — peer-to-peer; any agent messages any other at any time
     */
    mode: z.enum(['orchestrated', 'choreographed', 'adhoc']).default('orchestrated'),
    /** How long (ms) to wait for a banter reply before timing out */
    await_reply_timeout_ms: z.number().int().positive().default(30_000),
    /** Hard cap on total messages published per session; throws BusCapacityError when exceeded */
    max_messages_per_session: z.number().int().positive().default(500),
    /** Directory for per-agent inbox persistence. ~ is expanded to $HOME. */
    inbox_dir: z.string().default('~/.swarm/inbox'),
  }).default({}),

  telemetry: z.object({
    enabled: z.boolean().default(true),
    /** OTLP HTTP endpoint, e.g. http://localhost:4318 — empty string = file only */
    otlp_endpoint: z.string().default(''),
    /** Log file path. ~ is expanded to $HOME. */
    log_file: z.string().default('~/.swarm/logs/swarm.log'),
    log_level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  }).default({}),

  memory: z.object({
    /**
     * markdown    — write HANDOFF.md + MEMORY.md to memory.path (default, works today)
     * obsidian    — same files, copied into an Obsidian vault at memory.obsidian_vault
     * agentsynapse — route to AgentSynapse at memory.agentsynapse_url (stub, pending integration)
     * agentcognose — route to AgentCognose (stub, pending integration)
     */
    backend: z.enum(['markdown', 'obsidian', 'agentsynapse', 'agentcognose']).default('markdown'),
    /** Directory for handoff files. ~ expanded. Used by markdown and obsidian as the source. */
    path: z.string().default('~/.swarm/handoff'),
    /** Obsidian vault path — required when backend = "obsidian" */
    obsidian_vault: z.string().default(''),
    /** AgentSynapse / AgentCognose base URL */
    agentsynapse_url: z.string().default('http://localhost:8000'),
    /** Project name used when storing memories in AgentSynapse */
    agentsynapse_project: z.string().default('swarm'),
    /**
     * Context % threshold that triggers the memory write.
     * Accepts 80–95. Default 85. Set higher (90) on models with large context windows
     * to avoid triggering too early; set lower (80) if you want more buffer before cutoff.
     */
    context_threshold: z.number().int().min(80).max(95).default(85),
  }).default({}),

  hub: z.object({
    /** Port the hub server listens on (future — not yet running) */
    port: z.number().int().default(7777),
    /** Keep the hub process alive between CLI sessions */
    persist: z.boolean().default(false),
  }).default({}),
})

export type SwarmConfig = z.infer<typeof ConfigSchema>
export const defaultConfig: SwarmConfig = ConfigSchema.parse({})
