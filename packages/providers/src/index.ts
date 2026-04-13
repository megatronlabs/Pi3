export * from './types.js'
export * from './registry.js'
export { AnthropicProvider } from './anthropic.js'
export { OllamaProvider } from './ollama.js'
export { OpenRouterProvider } from './openrouter.js'
export { ReplicateProvider } from './replicate.js'
export { getContextWindow } from './contextWindows.js'

import { providerRegistry } from './registry.js'
import { AnthropicProvider } from './anthropic.js'
import { OllamaProvider } from './ollama.js'
import { OpenRouterProvider } from './openrouter.js'
import { ReplicateProvider } from './replicate.js'

/**
 * Convenience factory: create and register all providers whose credentials
 * are available in environment variables.
 */
export function createDefaultProviders(): void {
  // Anthropic — requires ANTHROPIC_API_KEY
  const anthropicKey = process.env['ANTHROPIC_API_KEY']
  if (anthropicKey) {
    providerRegistry.register(new AnthropicProvider({ apiKey: anthropicKey }))
  }

  // OpenRouter — requires OPENROUTER_API_KEY
  const openrouterKey = process.env['OPENROUTER_API_KEY']
  if (openrouterKey) {
    providerRegistry.register(new OpenRouterProvider({ apiKey: openrouterKey }))
  }

  // Replicate — requires REPLICATE_API_KEY
  const replicateKey = process.env['REPLICATE_API_KEY']
  if (replicateKey) {
    providerRegistry.register(new ReplicateProvider({ apiKey: replicateKey }))
  }

  // Ollama — always register; uses OLLAMA_BASE_URL or default localhost
  providerRegistry.register(new OllamaProvider())
}
