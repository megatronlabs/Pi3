#!/usr/bin/env bun
import React from 'react'
import { render } from 'ink'
import { Command } from 'commander'
import { providerRegistry, AnthropicProvider, OpenRouterProvider, OllamaProvider, ReplicateProvider } from '@swarm/providers'
import { Agent, SwarmAgentTool } from '@swarm/orchestrator'
import { defaultTools } from '@swarm/tools'
import { loadConfig, initConfig, resolveProviderKey, resolveBaseUrl, CONFIG_PATH } from '@swarm/config'
import { App } from './App'
import { adaptTools } from './adaptTool'
import { wrapWithTrainingWheels } from './trainingWheels'
import type { Provider } from '@swarm/providers'

const program = new Command()
  .name('swarm')
  .description('Multi-agent AI terminal — powered by swarm')
  .version('0.1.0')
  .option('-m, --model <model>', 'Model to use')
  .option('-p, --provider <provider>', 'Provider: anthropic | openrouter | ollama | replicate')
  .option('--working-dir <dir>', 'Working directory for tools', process.cwd())
  .option('--init-config', 'Create default config file at ~/.swarm/config.toml and exit')
  .option('-s, --swarm', 'Enable swarm mode (agent can spawn sub-agents via spawn_agent tool)')
  .option('--training-wheels', 'Restrict agent to read-only within working directory; writes require user approval')
  .action(async (opts: { model?: string; provider?: string; workingDir: string; initConfig?: boolean; swarm?: boolean; trainingWheels?: boolean }) => {
    // Handle --init-config flag
    if (opts.initConfig) {
      await initConfig()
      process.stdout.write(`Config initialized at: ${CONFIG_PATH}\n`)
      process.exit(0)
    }

    // Load config (returns defaults if file doesn't exist)
    const config = await loadConfig()

    // Apply config defaults for any flags not explicitly passed on CLI
    const providerName: string = opts.provider ?? config.defaults.provider
    const model: string = opts.model ?? config.defaults.model
    const workingDir: string = opts.workingDir !== process.cwd()
      ? opts.workingDir
      : (config.defaults.working_dir ?? opts.workingDir)

    // Resolve API key and base URL from config (falls back to env vars inside resolver)
    const apiKey = resolveProviderKey(config, providerName)
    const baseUrl = resolveBaseUrl(config, providerName)

    // Validate that key-requiring providers have a key
    const keyRequiredProviders = ['anthropic', 'openrouter', 'replicate']
    if (keyRequiredProviders.includes(providerName) && !apiKey) {
      const envVarMap: Record<string, string> = {
        anthropic: 'ANTHROPIC_API_KEY',
        openrouter: 'OPENROUTER_API_KEY',
        replicate: 'REPLICATE_API_KEY',
      }
      const envVar = envVarMap[providerName] ?? 'API_KEY'
      process.stderr.write(
        `Error: No API key found for provider "${providerName}".\n` +
          `Set it via config (providers.${providerName}.api_key) or environment variable ${envVar}.\n`,
      )
      process.exit(1)
    }

    // Construct the requested provider directly (no registry lookup needed)
    let provider: Provider
    switch (providerName) {
      case 'anthropic':
        provider = new AnthropicProvider({ apiKey: apiKey ?? '' })
        break
      case 'openrouter':
        provider = new OpenRouterProvider({ apiKey: apiKey ?? '', baseUrl })
        break
      case 'ollama':
        provider = new OllamaProvider({ baseUrl: baseUrl ?? 'http://localhost:11434' })
        break
      case 'replicate':
        provider = new ReplicateProvider({ apiKey: apiKey ?? '' })
        break
      default:
        process.stderr.write(`Error: Unknown provider "${providerName}".\nSupported: anthropic, openrouter, ollama, replicate\n`)
        process.exit(1)
    }

    // Register provider so anything else using the registry can find it
    providerRegistry.register(provider)

    // Determine if a config file exists on disk so we can show it in the banner
    const configFileExists = await Bun.file(CONFIG_PATH).exists()
    const configLabel = configFileExists ? `  ·  config: ${CONFIG_PATH.replace(process.env.HOME ?? '', '~')}` : ''

    // Print startup banner to stderr (won't interfere with Ink TUI on stdout)
    process.stderr.write(
      `swarm v0.1.0  ·  model: ${model}  ·  provider: ${providerName}${configLabel}\n`,
    )

    // Adapt @swarm/tools Tool instances to AgentTool interface
    const adaptedTools = adaptTools(defaultTools)

    // Training wheels: shared write-pass state between tool wrapper and App
    const writePassState = { approved: false }

    const sandboxedTools = opts.trainingWheels
      ? wrapWithTrainingWheels(adaptedTools, workingDir, {
          isWriteApproved: () => writePassState.approved,
          consumeWriteApproval: () => { writePassState.approved = false },
        })
      : adaptedTools

    // If swarm mode is enabled, add the SwarmAgentTool so the main agent can spawn sub-agents
    const agentTools = opts.swarm
      ? [
          ...sandboxedTools,
          new SwarmAgentTool({
            defaultProvider: provider,
            defaultModel: model,
            tools: sandboxedTools,
            workingDir,
          }),
        ]
      : sandboxedTools

    // Create the agent
    const agent = new Agent({
      id: 'main',
      name: 'swarm',
      provider,
      model,
      tools: agentTools,
      workingDir,
    })

    // Render TUI
    const { waitUntilExit } = render(
      <App
        agent={agent}
        workingDir={workingDir}
        adaptedTools={sandboxedTools}
        trainingWheels={opts.trainingWheels ?? false}
        writePassState={writePassState}
      />,
      { exitOnCtrlC: true },
    )

    await waitUntilExit()
  })

program.parse()
