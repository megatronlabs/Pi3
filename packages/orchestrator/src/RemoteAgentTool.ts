import { z } from 'zod'

// Minimal AgentTool interface (avoids circular deps with orchestrator)
interface AgentTool<TInput, TOutput> {
  name: string
  description: string
  inputSchema: z.ZodType<TInput>
  call(input: TInput, ctx: { workingDir: string }): Promise<TOutput>
  formatOutput(output: TOutput): string
  requiresApproval?(): boolean
}

const RemoteAgentSchema = z.object({
  host: z.string().describe(
    'Remote Pi3 instance URL, e.g. "http://192.168.1.100:3001". ' +
    'Must have --serve mode running.',
  ),
  prompt: z.string().describe('The task or question to send to the remote agent.'),
  timeout_ms: z.number().int().positive().optional().describe(
    'Maximum milliseconds to wait for the remote agent to finish. Default 120000.',
  ),
})

type RemoteAgentInput = z.infer<typeof RemoteAgentSchema>

/**
 * RemoteAgentTool — delegates a task to a Pi3 instance running in --serve mode
 * on a remote machine (or another port on the same machine).
 *
 * Connects via SSE (text/event-stream) to POST /agent/run on the remote host.
 * Accumulates streaming text and returns the full response once the agent finishes.
 */
export class RemoteAgentTool implements AgentTool<RemoteAgentInput, string> {
  name = 'run_remote_agent'
  description =
    'Run a task on a remote Pi3 agent (Ollama, Anthropic, etc.) via HTTP. ' +
    'The remote machine must be running Pi3 with the --serve flag. ' +
    'Use this to offload work to a more capable or differently-configured agent.'
  inputSchema = RemoteAgentSchema

  async call(input: RemoteAgentInput): Promise<string> {
    const { host, prompt, timeout_ms = 120_000 } = input
    const url = `${host.replace(/\/$/, '')}/agent/run`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout_ms)

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({ prompt }),
        signal: controller.signal,
      })

      if (!res.ok) {
        return `Remote agent error: HTTP ${res.status} from ${url}`
      }

      // Read SSE stream and accumulate text events
      const reader = res.body?.getReader()
      if (!reader) return 'Remote agent returned no body'

      const decoder = new TextDecoder()
      let accumulated = ''
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''  // keep the incomplete last line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const json = line.slice(6).trim()
          if (json === '[DONE]') { reader.cancel(); return accumulated }
          try {
            const event = JSON.parse(json) as { type?: string; delta?: string; message?: string }
            if (event.type === 'text' && event.delta) {
              accumulated += event.delta
            } else if (event.type === 'error' && event.message) {
              return `Remote agent error: ${event.message}`
            }
          } catch {
            // skip unparseable lines
          }
        }
      }

      return accumulated || '(remote agent returned no text)'
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return `Remote agent timed out after ${timeout_ms}ms`
      }
      return `Remote agent connection failed: ${err instanceof Error ? err.message : String(err)}`
    } finally {
      clearTimeout(timer)
    }
  }

  formatOutput(output: string): string { return output }
  requiresApproval(): boolean { return false }
}
