import { z } from 'zod'

const ProviderConfigSchema = z.object({
  api_key: z.string().optional(),
  base_url: z.string().optional(),
})

export const ConfigSchema = z.object({
  defaults: z.object({
    model: z.string().default('claude-opus-4-6'),
    provider: z.string().default('anthropic'),
    theme: z.enum(['dark']).default('dark'),
    working_dir: z.string().optional(),
  }).default({}),

  providers: z.object({
    anthropic: ProviderConfigSchema.default({}),
    openrouter: ProviderConfigSchema.default({}),
    ollama: ProviderConfigSchema.extend({
      base_url: z.string().default('http://localhost:11434'),
    }).default({}),
    replicate: ProviderConfigSchema.default({}),
  }).default({}),

  tools: z.object({
    // Commands that require approval before running (in addition to defaults)
    approval_required: z.array(z.string()).default([]),
    // Commands that are always denied
    denied_commands: z.array(z.string()).default([]),
  }).default({}),
})

export type SwarmConfig = z.infer<typeof ConfigSchema>
export const defaultConfig: SwarmConfig = ConfigSchema.parse({})
