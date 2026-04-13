/** Known context window sizes (in tokens) for common models. */
const CONTEXT_WINDOWS: Record<string, number> = {
  // Anthropic
  'claude-opus-4-6':          200000,
  'claude-sonnet-4-6':        200000,
  'claude-haiku-4-5-20251001':200000,
  'claude-3-5-sonnet-20241022':200000,
  'claude-3-opus-20240229':   200000,
  'claude-3-haiku-20240307':  200000,

  // Ollama / local
  'gemma3:4b':   8192,
  'gemma3:12b':  8192,
  'gemma3:27b':  8192,
  'gemma2:2b':   8192,
  'gemma2:9b':   8192,
  'qwen2.5:3b':  32768,
  'qwen2.5:7b':  32768,
  'qwen2.5:14b': 32768,
  'qwen2.5:32b': 32768,
  'llama3.2:1b': 131072,
  'llama3.2:3b': 131072,
  'llama3.1:8b': 131072,
  'llama3.1:70b':131072,
  'mistral':     32768,
  'mistral:7b':  32768,
  'phi3:mini':   4096,
  'phi3:medium': 4096,
  'phi4':        16384,
  'deepseek-r1:7b':  65536,
  'deepseek-r1:14b': 65536,
}

/**
 * Return the context window size for a given model ID.
 * Falls back to 8192 for unknown models.
 */
export function getContextWindow(model: string): number {
  return CONTEXT_WINDOWS[model] ?? 8192
}
