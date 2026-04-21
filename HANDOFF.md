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

## Next Build — Memory Management (4 tasks, do in order)

**Context:** memory write (handoff) works. Memory *read* is broken — agent can't load prior context
on startup, `store/get/search` aren't persisted, hub isn't started automatically.
Agreed design: **working-directory fingerprint** for auto-inject (Option A) — only load memory
that was written from the same `workingDir`, so new projects get a blank slate automatically.

**Typecheck after every file.** Full check before each commit:
```
for pkg in packages/bus packages/telemetry packages/hermes packages/providers packages/tools \
  packages/orchestrator packages/tui packages/hub packages/config packages/mcp apps/cli; do
  result=$(cd /Users/jeffblakely/Source/Pi3/$pkg && bunx tsc --noEmit 2>&1)
  [ -n "$result" ] && echo "FAIL $pkg:" && echo "$result" || echo "OK $pkg"
done
```

---

### Task 1 — Tag handoff files with workingDir *(~10 min)*

**Goal:** stamp every HANDOFF.md + MEMORY.md with the workingDir so we can find the right
memory on next startup.

**File: `apps/cli/src/App.tsx` — `buildHandoffPrompt()`**

Add a frontmatter block at the top of both files the agent writes:
```
---
workingDir: /absolute/path/to/project
sessionId: session-1234567890
timestamp: 2026-04-20T10:00:00.000Z
---
```

Change `buildHandoffPrompt(pct, handoffDir)` to also accept `workingDir: string` and embed it
in the instruction text:
```
Each file must begin with this exact frontmatter (no blank line before ---):
---
workingDir: <workingDir>
sessionId: <sessionId>
timestamp: <ISO timestamp>
---
```

Pass `workingDir` into `buildHandoffPrompt()` at the call site in the handoff `useEffect`.

**File: `packages/hub/src/memory/MemoryProvider.ts`**

Add `workingDir: string` to `HandoffFiles` interface.

**File: `apps/cli/src/App.tsx` — handoff `useEffect`**

Pass `workingDir` into the `HandoffFiles` object when calling `memoryProvider.onHandoffComplete()`.

Commit: `feat(memory): tag handoff files with workingDir frontmatter`

---

### Task 2 — Auto-inject MEMORY.md on startup *(~20 min)*

**Goal:** on startup, find the most recent MEMORY.md in `handoffDir` whose frontmatter
`workingDir` matches the current working dir. If found, prepend it to the agent's system prompt.

**New file: `packages/hub/src/memory/loadMemory.ts`**

```typescript
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

export interface LoadedMemory {
  content: string       // full MEMORY.md text
  workingDir: string    // from frontmatter
  sessionId: string
  timestamp: Date
  path: string
}

/**
 * Scan handoffDir for MEMORY.md files matching workingDir.
 * Returns the most recently written one, or null if none found.
 *
 * Looks for files named MEMORY.md or MEMORY-<sessionId>.md.
 * Reads frontmatter (--- block at top) to extract workingDir.
 */
export async function loadMemoryForDir(
  handoffDir: string,
  workingDir: string,
): Promise<LoadedMemory | null>
```

Implementation notes:
- `readdir(handoffDir)` — filter for `*.md` files containing "MEMORY"
- For each, read the file and parse the `---` frontmatter block (simple line-by-line, no yaml lib needed)
- Match `workingDir:` line against current `workingDir`
- Pick the one with the most recent `timestamp:` (or fall back to file mtime)
- Return the full file content (frontmatter + body) and parsed metadata
- Return `null` if dir doesn't exist or no match found — never throw

Export from `packages/hub/src/index.ts`.

**File: `apps/cli/src/index.tsx`**

After `loadConfig()` and before rendering App, load memory:

```typescript
import { loadMemoryForDir } from '@swarm/hub'

const loadedMemory = await loadMemoryForDir(handoffDir, workingDir)

// If found, prepend to agent system prompt
const memorySystemPrompt = loadedMemory
  ? `\n\n## Memory from previous session (${loadedMemory.timestamp.toISOString().slice(0,10)})\n\n${loadedMemory.content}`
  : ''

// Combine with existing commSystemPrompt:
// Agent is created with: systemPrompt: commSystemPrompt + memorySystemPrompt
```

Pass `loadedMemory` (or just a boolean `hadMemory`) to `<App>` so it can show a banner:

**File: `apps/cli/src/App.tsx`**

Add `loadedMemory?: { timestamp: Date; path: string }` to `AppProps`.

On first render (empty `useEffect []`), if `loadedMemory` is set, push a system message:
```
📂 Memory loaded from previous session (2026-04-18) — ~/.swarm/handoff/MEMORY.md
```

Commit: `feat(memory): auto-inject MEMORY.md on startup matched by workingDir`

---

### Task 3 — Persistent store/get/search via hub file store *(~25 min)*

**Goal:** `MarkdownMemoryProvider.store/get/search` currently use an in-memory Map that dies
with the process. Replace with file-backed persistence using the existing `MemoryStore` class
already built in `packages/hub/src/store/`.

Read `packages/hub/src/store/` before starting — `MemoryStore` already has `set/get/search`.
Check whether it's already exported from `packages/hub/src/index.ts`.

**File: `packages/hub/src/memory/MarkdownMemoryProvider.ts`**

Replace the `private _store = new Map<...>()` with a `MemoryStore` instance:

```typescript
import { MemoryStore } from '../store/MemoryStore.js'  // adjust path if needed

export class MarkdownMemoryProvider implements MemoryProvider {
  readonly backend = 'markdown' as const
  private _memStore: MemoryStore

  constructor(dataDir: string) {
    // dataDir = expandPath('~/.swarm/hub/memory')
    this._memStore = new MemoryStore(dataDir)
  }

  async store(namespace, key, value, metadata?): Promise<void> {
    await this._memStore.set(namespace, key, value, metadata)
  }

  async get(namespace, key): Promise<string | null> {
    return this._memStore.get(namespace, key)
  }

  async search(namespace, query, limit?): Promise<MemorySearchResult[]> {
    return this._memStore.search(namespace, query, limit)
  }
}
```

**File: `packages/hub/src/memory/createMemoryProvider.ts`**

Update the `'markdown'` case to pass a `dataDir`:
```typescript
case 'markdown':
  return new MarkdownMemoryProvider(
    expandPath('~/.swarm/hub/memory')
  )
```

**File: `apps/cli/src/index.tsx`**

No changes needed if `createMemoryProvider` handles it internally.

Commit: `feat(memory): persist store/get/search to disk via MemoryStore`

---

### Task 4 — memory_read + memory_search agent tools *(~20 min)*

**Goal:** give the agent two new tools so it can query its own memory programmatically.

**New file: `packages/hub/src/memory/MemoryTools.ts`**

Two `AgentTool`-compatible classes (use the same local interface pattern as `CreateSkillTool` — 
don't import from `@swarm/orchestrator` to avoid circular deps):

```typescript
// Tool 1: memory_search
// Input: { query: string, namespace?: string, limit?: number }
// Calls memoryProvider.search(namespace ?? 'default', query, limit ?? 5)
// Returns formatted results or "No memories found."

// Tool 2: memory_read  
// Input: { key: string, namespace?: string }
// Calls memoryProvider.get(namespace ?? 'default', key)
// Returns the value or "No memory found for key '<key>'."
```

Both accept a `MemoryProvider` in their constructor.

Export `MemorySearchTool` and `MemoryReadTool` from `packages/hub/src/index.ts`.

**File: `apps/cli/src/index.tsx`**

```typescript
import { MemorySearchTool, MemoryReadTool } from '@swarm/hub'

const memorySearchTool = new MemorySearchTool(memoryProvider)
const memoryReadTool = new MemoryReadTool(memoryProvider)

// Add to agentTools (both swarm and non-swarm paths):
const agentTools = opts.swarm
  ? [...sandboxedTools, swarmAgentTool, sendMessageTool, createSkillTool, memorySearchTool, memoryReadTool]
  : [...sandboxedTools, sendMessageTool, createSkillTool, memorySearchTool, memoryReadTool]
```

Commit: `feat(memory): memory_search + memory_read agent tools`

---

### After all 4 tasks — push

```
git push
```

---

## Important Rules

- **CC source** = reference only (proprietary). pi-mono + hermes-agent = free to use.
- All code must typecheck clean: `cd <package> && bunx tsc --noEmit`
- Check all packages after changes: bus, telemetry, hermes, providers, tools, orchestrator, tui, hub, config, mcp, apps/cli
- Commit after each task, push after all are clean
