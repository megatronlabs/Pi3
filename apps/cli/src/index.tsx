#!/usr/bin/env bun
import React from 'react'
import { render } from 'ink'
import { Command } from 'commander'
import { providerRegistry, AnthropicProvider, OpenRouterProvider, OllamaProvider, ReplicateProvider } from '@swarm/providers'
import { Agent, SwarmAgentTool, WorkerPool } from '@swarm/orchestrator'
import { defaultTools } from '@swarm/tools'
import { loadConfig, initConfig, resolveProviderKey, resolveBaseUrl, CONFIG_PATH, resolveRole, resolveAllRoles, listPresets } from '@swarm/config'
import { App } from './App'
import { getTheme, applyThemeOverrides } from '@swarm/tui'
import type { BorderStyle } from '@swarm/tui'
import { adaptTools } from './adaptTool'
import { wrapWithTrainingWheels } from './trainingWheels'
import type { Provider } from '@swarm/providers'
import { MessageBus, AgentRegistry } from '@swarm/bus'
import type { CommunicationMode } from '@swarm/bus'
import { telemetry } from '@swarm/telemetry'
import { SendAgentMessageTool, buildCommSystemPrompt } from '@swarm/orchestrator'
import { createMemoryProvider, expandPath, SkillStore, CreateSkillTool } from '@swarm/hub'
import type { Skill } from '@swarm/hub'
import { McpManager } from '@swarm/mcp'
import type { McpServerInfo } from '@swarm/mcp'

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
  .option('--preset <preset>', 'Model preset to use: quality | fast | local | mixed | default')
  .option('--comm-mode <mode>', 'Inter-agent comm mode: orchestrated | choreographed | adhoc')
  .option('--comm-format <format>', 'Message format: hermes | english (default: hermes)')
  .action(async (opts: { model?: string; provider?: string; workingDir: string; initConfig?: boolean; swarm?: boolean; trainingWheels?: boolean; preset?: string; commMode?: string; commFormat?: string }) => {
    // Handle --init-config flag
    if (opts.initConfig) {
      await initConfig()
      process.stdout.write(`Config initialized at: ${CONFIG_PATH}\n`)
      process.exit(0)
    }

    // Load config (returns defaults if file doesn't exist)
    const config = await loadConfig()

    // -------------------------------------------------------------------------
    // Hub server (optional — only when config.hub.persist = true)
    //
    // The hub runs as a detached background process that outlives the CLI.
    // On each CLI startup we:
    //   1. Health-check the hub — if it's already up, reuse it
    //   2. If not running, spawn a new detached hub process
    //   3. Poll /health until ready (up to ~3 s), then wire it in
    // -------------------------------------------------------------------------
    let hubBaseUrl: string | undefined
    if (config.hub.persist) {
      const hubUrl = `http://localhost:${config.hub.port}`
      const isAlive = async (): Promise<boolean> =>
        fetch(`${hubUrl}/health`).then(r => r.ok).catch(() => false)

      try {
        if (await isAlive()) {
          // Already running from a previous session
          hubBaseUrl = hubUrl
        } else {
          const { spawnHubDaemon } = await import('@swarm/hub')
          await spawnHubDaemon(config.hub.port, expandPath('~/.swarm/hub'))

          // Poll until the hub is ready (max ~3 s)
          for (let i = 0; i < 15; i++) {
            await Bun.sleep(200)
            if (await isAlive()) { hubBaseUrl = hubUrl; break }
          }

          if (!hubBaseUrl) {
            process.stderr.write('[swarm] Hub did not become ready in time — continuing without it\n')
          }
        }
      } catch (err) {
        process.stderr.write(`[swarm] Hub failed to start: ${err}\n`)
      }
    }

    // -------------------------------------------------------------------------
    // Telemetry
    // -------------------------------------------------------------------------
    telemetry.init({
      enabled: config.telemetry.enabled,
      // Point OTLP at the hub when running; otherwise fall back to config value
      otlpEndpoint: hubBaseUrl ?? (config.telemetry.otlp_endpoint || undefined),
      logFile: config.telemetry.log_file,
      logLevel: config.telemetry.log_level,
    })

    // -------------------------------------------------------------------------
    // Communication bus
    // -------------------------------------------------------------------------
    const commMode = (opts.commMode ?? config.communication.mode) as CommunicationMode
    const commFormat = (opts.commFormat ?? config.communication.format) as 'hermes' | 'english'
    const sessionId = `session-${Date.now()}`

    // Bus is always created so the CommLog panel works; it's just empty until
    // agents start sending messages.
    const bus = new MessageBus({
      maxMessages: config.communication.max_messages_per_session,
      inboxDir: expandPath(config.communication.inbox_dir),
    })

    // Agent registry — tracks running agents with presence status
    const registry = new AgentRegistry(expandPath('~/.swarm/agents/registry.json'))
    process.on('exit', () => { registry.remove('main').catch(() => {}) })

    // Wire telemetry to log every inter-agent message
    bus.monitor(msg => telemetry.logMessage(msg))

    // logSession called later once model/providerName are resolved

    // -------------------------------------------------------------------------
    // Memory provider
    // -------------------------------------------------------------------------
    const memoryProvider = createMemoryProvider({
      backend:              config.memory.backend,
      path:                 config.memory.path,
      obsidian_vault:       config.memory.obsidian_vault || undefined,
      // When hub is running, route memory through it; otherwise use config URL
      agentsynapse_url:     hubBaseUrl ?? config.memory.agentsynapse_url,
      agentsynapse_project: config.memory.agentsynapse_project,
    })
    const contextThreshold = config.memory.context_threshold
    const handoffDir = expandPath(config.memory.path)

    // Skills store — loads persisted slash-command skills from ~/.swarm/skills/
    const skillStore = new SkillStore(expandPath('~/.swarm/skills'))
    const skills = await skillStore.load()

    // Resolve active preset (CLI flag > config file > 'default')
    const activePreset = opts.preset ?? config.defaults.preset ?? 'default'

    // Resolve chat role for the main agent (overridden by -m/-p flags)
    const chatRole = resolveRole(config, 'chat', activePreset)
    const allRoles = resolveAllRoles(config, activePreset)

    // Apply config defaults for any flags not explicitly passed on CLI
    const providerName: string = opts.provider ?? chatRole.provider
    const model: string = opts.model ?? chatRole.model
    telemetry.logSession('start', sessionId, model, providerName)
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

    // MCP servers
    const mcpManager = new McpManager()
    if (config.mcp.servers.length > 0) {
      await mcpManager.connectAll(config.mcp.servers)
    }
    const mcpTools = mcpManager.getTools()
    const allTools = [...sandboxedTools, ...mcpTools as unknown as typeof sandboxedTools[0][]]
    process.on('exit', () => { mcpManager.disconnectAll() })

    // SendAgentMessageTool — always available so agents can communicate via bus
    const sendMessageTool = new SendAgentMessageTool({
      agentId: 'main',
      sessionId,
      bus,
      language: commFormat,
    })

    // If swarm mode is enabled, add the SwarmAgentTool so the main agent can spawn sub-agents
    const agentTools = opts.swarm
      ? [
          ...allTools,
          new SwarmAgentTool({
            defaultProvider: provider,
            defaultModel: model,
            tools: allTools,
            workingDir,
            bus,
            sessionId,
            language: commFormat,
          }),
          sendMessageTool,
        ]
      : [...allTools, sendMessageTool]

    // System prompt addendum explaining the bus to the agent
    const commSystemPrompt = buildCommSystemPrompt('main', commMode, commFormat)

    // Create the agent
    const agent = new Agent({
      id: 'main',
      name: 'swarm',
      provider,
      model,
      tools: agentTools,
      systemPrompt: commSystemPrompt,
      workingDir,
      bus,
      sessionId,
      registry,
    })

    // Resolve theme from config
    const baseTheme = getTheme(config.defaults.theme)
    const themeOverrides = config.theme
    const theme = applyThemeOverrides(baseTheme, {
      ...(themeOverrides.border_style && { borderStyle: themeOverrides.border_style as BorderStyle }),
      ...(themeOverrides.primary && { primary: themeOverrides.primary }),
      ...(themeOverrides.secondary && { secondary: themeOverrides.secondary }),
      ...(themeOverrides.muted && { muted: themeOverrides.muted }),
      ...(themeOverrides.accent && { accent: themeOverrides.accent }),
      ...(themeOverrides.error && { error: themeOverrides.error }),
      ...(themeOverrides.warning && { warning: themeOverrides.warning }),
      ...(themeOverrides.success && { success: themeOverrides.success }),
      ...(themeOverrides.user && { user: themeOverrides.user }),
      ...(themeOverrides.assistant && { assistant: themeOverrides.assistant }),
      ...(themeOverrides.tool && { tool: themeOverrides.tool }),
      ...(themeOverrides.thinking && { thinking: themeOverrides.thinking }),
      ...(themeOverrides.border && { border: themeOverrides.border }),
      ...(themeOverrides.input_border && { inputBorder: themeOverrides.input_border }),
    })

    const KNOWN_PROVIDERS = [
      { id: 'anthropic',  name: 'Anthropic',  models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'] },
      { id: 'openrouter', name: 'OpenRouter', models: ['openai/gpt-4o', 'anthropic/claude-opus-4-6', 'meta-llama/llama-3.1-70b-instruct'] },
      { id: 'ollama',     name: 'Ollama',     models: ['gemma3:4b', 'gemma3:12b', 'llama3.2:3b', 'mistral:7b', 'deepseek-r1:7b'] },
      { id: 'replicate',  name: 'Replicate',  models: ['meta/llama-3-70b-instruct', 'mistralai/mistral-7b-instruct-v0.2'] },
    ]

    // Render TUI
    const { waitUntilExit } = render(
      <App
        agent={agent}
        workingDir={workingDir}
        adaptedTools={allTools}
        mcpStatus={mcpManager.getStatus()}
        trainingWheels={opts.trainingWheels ?? false}
        writePassState={writePassState}
        activePreset={activePreset}
        allRoles={allRoles}
        bus={bus}
        commMode={commMode}
        memoryProvider={memoryProvider}
        contextThreshold={contextThreshold}
        handoffDir={handoffDir}
        sessionId={sessionId}
        theme={theme}
        providers={KNOWN_PROVIDERS}
        skills={skills}
        skillStore={skillStore}
        onModelSwap={(providerId, model) => {
          let newProvider: Provider
          switch (providerId) {
            case 'anthropic':
              newProvider = new AnthropicProvider({ apiKey: resolveProviderKey(config, 'anthropic') ?? '' })
              break
            case 'openrouter':
              newProvider = new OpenRouterProvider({ apiKey: resolveProviderKey(config, 'openrouter') ?? '', baseUrl: resolveBaseUrl(config, 'openrouter') })
              break
            case 'ollama':
              newProvider = new OllamaProvider({ baseUrl: resolveBaseUrl(config, 'ollama') ?? 'http://localhost:11434' })
              break
            case 'replicate':
              newProvider = new ReplicateProvider({ apiKey: resolveProviderKey(config, 'replicate') ?? '' })
              break
            default:
              return
          }
          agent.swapProvider(newProvider, model)
        }}
        swarmMode={opts.swarm ?? false}
        workerFactory={(count: number) => {
          const pool = new WorkerPool()
          const cap = Math.min(count, 4)
          for (let i = 0; i < cap; i++) {
            pool.addWorker({
              id: `worker-${i}`,
              name: `Worker ${i + 1}`,
              provider,
              model,
              tools: allTools,
              workingDir,
              bus,
              registry,
            })
          }
          return pool
        }}
      />,
      { exitOnCtrlC: true },
    )

    await waitUntilExit()
  })

program.parse()
