# Pi3 Swarm — Handoff

**Date:** 2026-04-14
**Repo:** https://github.com/megatronlabs/Pi3
**Last commit:** b9e682d — feat(bus): wire spawn_agent to bus + inbox polling for cross-process messaging

---

## What This Project Is

Multi-agent AI terminal (Claude Code-like TUI) built on Bun + Ink v6 + React 19.
Supports multiple LLM providers: Anthropic, OpenRouter, Ollama, Replicate.
Run with: `bun run apps/cli/src/index.tsx -p ollama -m gemma3:4b`

**Key flags:** `--swarm`, `--training-wheels`, `--preset quality|fast|local|mixed`,
`--comm-mode orchestrated|choreographed|adhoc`, `--comm-format hermes|english`

---

## Package Map

```
packages/
  bus/          AgentMessage types, MessageBus (in-memory pub/sub + inbox persistence),
                AgentRegistry (presence tracking via lastActiveAt), BusCapacityError
  telemetry/    OTEL-compatible structured logger → file + OTLP HTTP
  hermes/       Hermes XML format serializer/parser
  providers/    Anthropic, Ollama, OpenRouter, Replicate adapters
  tui/          Ink components: FullscreenLayout, MessageList, PromptInput, StatusLine,
                AgentPanel, CommLog, SlashMenu, ModelPicker
  tools/        BashTool, FileRead/Write/Edit, Glob, Grep
  orchestrator/ Agent (bus-aware, registry-aware), QueryEngine, Coordinator, TaskGraph,
                WorkerPool, SwarmAgentTool (spawn_agent), SendAgentMessageTool,
                SwarmPlannerTools (SwarmAddTaskTool + SwarmRunTool)
  config/       ~/.swarm/config.toml schema + loaders
  hub/          MemoryProvider interface + MarkdownMemoryProvider, ObsidianMemoryProvider,
                AgentSynapseProvider, HubServer (memory/OTLP/registry/sessions API),
                SkillStore, CreateSkillTool, spawnHubDaemon
  mcp/          McpManager, McpClient (stdio JSON-RPC), McpAgentTool
apps/
  cli/          Entry point (index.tsx) + App.tsx (TUI state) + adaptTool.ts
```

---

## Current State — What Works

- Full single-agent chat loop (streaming, tool use, multi-turn, thinking blocks)
- Providers: Anthropic, Ollama (tested with gemma3:4b), OpenRouter, Replicate
- Tools: bash, file_read, file_write, file_edit, glob, grep
- Slash commands: /clear /compact /config /exit /help /mcp /model /preset /skills /status /theme /training-wheels
- Ctrl+W = AgentPanel (swarm workers), Ctrl+L = CommLog (inter-agent messages), Ctrl+M = ModelPicker, Ctrl+C = exit
- **Coordinator swarm mode** (`--swarm`): agent decomposes prompt via swarm_add_task (N calls) + swarm_run → App creates WorkerPool + Coordinator → parallel task execution with dependency ordering → CoordinatorEvents update AgentPanel in real time
- **Model live-switching** (Ctrl+M / /model): ModelPicker overlay, agent.swapProvider() mid-session; provider/model resolved from config on swap
- **Inter-agent messaging — in-process**: MessageBus subscribe at Agent construction; messages queued in _pendingMessages, prepended to next run() prompt
- **Inter-agent messaging — cross-process**: MessageBus._persistToInbox() writes atomic tmp→rename JSON files to ~/.swarm/inbox/<agentId>/; App polls readInbox('main') every 2s, deduplicates by seenIds, injects via agent.injectMessage()
- **Banter (query + await reply)**: MessageBus.banter() stores Promise in _pendingBanter keyed by msg.id; resolved when a type='reply' message with matching correlationId arrives
- Sub-agents spawned via spawn_agent subscribe to bus (bus.subscribe) and have SendAgentMessageTool automatically added to their tool list
- **MCP integration**: McpManager.connectAll() on startup spawns child processes (stdio JSON-RPC); tools/list on connect; each tool wrapped as McpAgentTool and injected into agent; /mcp shows server status + tool count; full disconnect on exit
- **Skill auto-creation**: create_skill tool (CreateSkillTool) → SkillStore.save() → ~/.swarm/skills/{name}.json; loaded on next session startup; /skills lists them; skill names become live slash commands that re-submit their stored prompt
- **Agent registry**: AgentRegistry persists to ~/.swarm/agents/registry.json (atomic writes); agents register on construction, update lastActiveAt after each run(); status computed at read time from age of lastActiveAt (active <30s, idle <5min, away >5min); removed on dispose()/exit
- **Message budget**: BusCapacityError thrown from publish()/banter() when max_messages_per_session is exceeded; configurable in [communication]
- **Inbox persistence**: atomic writes (tmp→rename) to ~/.swarm/inbox/<agentId>/<ts>-<id>.json; broadcasts fan out to all subscriber dirs; readInbox() + clearInbox() on MessageBus
- **Hub server**: HubServer class with memory API (store/get/search/handoff), OTLP log collector, agent registry proxy, session history; spawned as detached daemon via spawnHubDaemon() when hub.persist=true; CLI polls /health and reuses existing instance
- **Memory handoff**: context % threshold (default 85%) triggers buildHandoffPrompt → agent writes HANDOFF.md + MEMORY.md → App calls memoryProvider.onHandoffComplete(files); backends: markdown (default), obsidian (vault copy), agentsynapse (HTTP)
- **Themes**: dark / light / dracula / catppuccin / nord / gruvbox; selectable via /theme or defaults.theme in config; per-color overrides in [theme] section; ThemeProvider wraps entire TUI
- Model roles + presets system (quality / fast / local / mixed); role map per preset, resolved at startup
- Training wheels mode: bash disabled, path containment, write approval required
- Telemetry: structured OTEL-compatible logger; wired to bus monitor; writes to ~/.swarm/logs/swarm.log; optional OTLP HTTP endpoint (auto-pointed at hub when hub is running)

---

## Next Tasks — Phase 4 Remaining

1. **Remote agents** — Linux box via SSH or HTTP → Ollama. Design: a RemoteAgentTool that POSTs tasks to a running Pi3 HTTP endpoint on the remote machine; responses streamed back. Needs a minimal HTTP mode for the CLI (`--serve` flag).

2. **/model overlay: dynamic model lists** — KNOWN_PROVIDERS in index.tsx has hardcoded model lists. Populate dynamically by querying each provider's API at startup (Anthropic models endpoint, Ollama `/api/tags`, OpenRouter `/api/v1/models`). Gate behind a config flag so it doesn't block startup.

3. **Coordinator choreographed mode** — Current Coordinator is adhoc parallel (any unblocked task runs on any idle worker). Add a choreographed mode: a linear pipeline where each agent's output is passed as input to the next, like a chain. `--comm-mode choreographed` should activate this path.

4. **AgentSynapseProvider — complete implementation** — The stub exists in `packages/hub/src/memory/AgentSynapseProvider.ts`. Now that HubServer exists and exposes a memory API, wire AgentSynapseProvider to POST handoff files to `hubBaseUrl/api/memory/handoff` and implement store/get/search against the hub's memory endpoints.

5. **Hub startup wiring** — HubServer class and spawnHubDaemon() exist and are wired in index.tsx when `hub.persist=true`. The actual daemon script (the entry point that `spawnHubDaemon` launches) needs to be confirmed/completed; verify the daemon file path and that hub data dir is initialized before the server starts.

6. **Skill parametrization** — SkillStore skills have a static `prompt` field. Add `{input}` placeholder substitution: when a skill slash command is invoked with text after the command name (e.g. `/review-pr 42`), substitute `{input}` in the prompt before submitting. Requires changes in App.tsx onCommand default case.

7. **CommLog banter thread visualization** — CommLog currently shows a flat chronological list. Add visual grouping of query → reply pairs linked by `correlationId`, so banter exchanges are shown as threads rather than disconnected messages.

---

## Config File Reference (~/.swarm/config.toml)

```toml
[defaults]
model = "claude-opus-4-6"
provider = "anthropic"
theme = "dark"          # dark | light | dracula | catppuccin | nord | gruvbox

[theme]
# Per-color overrides applied on top of the named theme (all optional)
# border_style = "round"   # single | double | round | bold | classic
# primary = "#ff79c6"
# accent = "#50fa7b"

[roles]
# Direct role assignments (used when preset = "default")
# chat = { model = "claude-opus-4-6", provider = "anthropic" }
# coding = { model = "claude-sonnet-4-6", provider = "anthropic" }

[presets.quality]
chat = { model = "claude-opus-4-6", provider = "anthropic" }

[presets.local]
chat = { model = "gemma3:4b", provider = "ollama" }

[providers.anthropic]
api_key = ""   # or set ANTHROPIC_API_KEY env var

[providers.ollama]
base_url = "http://localhost:11434"

[communication]
format = "hermes"                  # hermes | english
mode = "orchestrated"              # orchestrated | choreographed | adhoc
await_reply_timeout_ms = 30000
max_messages_per_session = 500
inbox_dir = "~/.swarm/inbox"

[memory]
backend = "markdown"               # markdown | obsidian | agentsynapse
path = "~/.swarm/handoff"
context_threshold = 85             # 80–95

[telemetry]
enabled = true
log_file = "~/.swarm/logs/swarm.log"

[hub]
port = 7777
persist = false

[[mcp.servers]]
name = "example"
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
enabled = true
```

---

## Key File Locations

| What | Where |
|---|---|
| Entry point | `apps/cli/src/index.tsx` |
| TUI state + handoff | `apps/cli/src/App.tsx` |
| Bus types | `packages/bus/src/types.ts` |
| MessageBus | `packages/bus/src/MessageBus.ts` |
| AgentRegistry | `packages/bus/src/AgentRegistry.ts` |
| Agent | `packages/orchestrator/src/Agent.ts` |
| Coordinator | `packages/orchestrator/src/Coordinator.ts` |
| WorkerPool | `packages/orchestrator/src/WorkerPool.ts` |
| SwarmAgentTool (spawn_agent) | `packages/orchestrator/src/SwarmAgentTool.ts` |
| SwarmPlannerTools | `packages/orchestrator/src/SwarmPlannerTools.ts` |
| send_agent_message tool | `packages/orchestrator/src/SendAgentMessageTool.ts` |
| Config schema | `packages/config/src/schema.ts` |
| Memory providers | `packages/hub/src/memory/` |
| SkillStore | `packages/hub/src/skills/SkillStore.ts` |
| CreateSkillTool | `packages/hub/src/skills/CreateSkillTool.ts` |
| Hub server | `packages/hub/src/HubServer.ts` |
| MCP manager | `packages/mcp/src/McpManager.ts` |
| MCP client | `packages/mcp/src/McpClient.ts` |
| CommLog TUI | `packages/tui/src/CommLog.tsx` |
| StatusLine | `packages/tui/src/StatusLine.tsx` |
| Handoff prompt | `apps/cli/src/App.tsx` — `buildHandoffPrompt()` |
| Architecture doc | `ARCHITECTURE.md` |

---

## Important Rules

- **CC source** = reference only (proprietary). pi-mono + hermes-agent = free to use.
- All code must typecheck clean: `cd <package> && bunx tsc --noEmit`
- Check all packages after changes: bus, telemetry, hermes, providers, tools, orchestrator, tui, hub, config, mcp, apps/cli
- Commit after each task, push after all are clean
