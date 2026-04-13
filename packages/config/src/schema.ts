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
})

export type SwarmConfig = z.infer<typeof ConfigSchema>
export const defaultConfig: SwarmConfig = ConfigSchema.parse({})
