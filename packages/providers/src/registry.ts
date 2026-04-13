import type { Provider, ProviderRegistry } from './types.js'

class SimpleProviderRegistry implements ProviderRegistry {
  private readonly providers = new Map<string, Provider>()

  register(provider: Provider): void {
    this.providers.set(provider.id, provider)
  }

  get(id: string): Provider | undefined {
    return this.providers.get(id)
  }

  list(): Provider[] {
    return Array.from(this.providers.values())
  }
}

export const providerRegistry: ProviderRegistry = new SimpleProviderRegistry()
