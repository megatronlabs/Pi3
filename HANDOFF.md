# Pi3 Swarm — Handoff

**Date:** 2026-04-20
**Repo:** https://github.com/megatronlabs/Pi3
**Last commit:** 01ceb4c — feat(swarm): remote agents via --serve + RemoteAgentTool

---

## What This Project Is

Multi-agent AI terminal (Claude Code-like TUI) built on Bun + Ink v6 + React 19.
Supports multiple LLM providers: Anthropic, OpenRouter, Ollama, Replicate.
Run with: `bun run apps/cli/src/index.tsx -p ollama -m gemma3:4b`

**Key flags:** `--swarm`, `--training-wheels`, `--preset quality|fast|local|mixed`,
`--comm-mode orchestrated|choreographed|adhoc`, `--comm-format hermes|english`,
`--serve [port]` (headless HTTP agent server, default 3001)

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
                AgentPanel, CommLog (banter thread visualization), SlashMenu, ModelPicker
  tools/        BashTool, FileRead/Write/Edit, Glob, Grep
  orchestrator/ Agent (bus-aware, registry-aware), QueryEngine, Coordinator,
                ChoreographedCoordinator (sequential pipeline), TaskGraph,
                WorkerPool, SwarmAgentTool (spawn_agent), SendAgentMessageTool,
                SwarmPlannerTools (SwarmAddTaskTool + SwarmRunTool),
                RemoteAgentTool (run_remote_agent)
  config/       ~/.swarm/config.toml schema + loaders (keychain-aware)
  hub/          MemoryProvider interface + MarkdownMemoryProvider (file-backed),
                ObsidianMemoryProvider, AgentSynapseProvider (hub API),
                HubMemoryProvider, HubServer (memory/OTLP/registry/sessions API),
                loadMemoryForDir (workingDir-matched startup injection),
                MemorySearchTool + MemoryReadTool, SkillStore, CreateSkillTool,
                spawnHubDaemon, server.ts (daemon entry point)
  mcp/          McpManager, McpClient (stdio JSON-RPC), McpAgentTool
  keychain/     Platform-aware secure key storage (macOS Keychain / libsecret / AES file)
apps/
  cli/          Entry point (index.tsx) + App.tsx (TUI state) + adaptTool.ts
                + wizard.tsx (--setup API key wizard)
```

---

## Current State — What Works

Everything from the previous handoff, plus:

- **Memory read on startup**: `loadMemoryForDir` scans `~/.swarm/handoff/` for MEMORY\*.md files,
  matches by `workingDir` frontmatter, injects the most recent match into the agent system prompt.
  App shows a banner when memory is loaded.
- **Handoff frontmatter stamping**: both HANDOFF.md and MEMORY.md now include `---\nworkingDir/sessionId/timestamp\n---`
  frontmatter so future sessions can locate the right file.
- **Persistent KV memory**: `MarkdownMemoryProvider` now backed by `MemoryStore` (JSON files in
  `~/.swarm/hub/memory/`) — `store/get/search` survive process restarts.
- **memory_search + memory_read tools**: agent can query its own KV memory programmatically.
- **Skill parametrization**: `/skill-name arg text` substitutes `{input}` in the skill prompt.
  Menu-invoked skills substitute `{input}` with empty string.
- **CommLog banter threads**: query/reply pairs linked by `correlationId` render as threads
  with `└─` indent. maxRows budget accounts for thread height.
- **AgentSynapseProvider complete**: `agentcognose` backend POSTs handoff to hub
  `/api/memory/handoff` and stores MEMORY.md content in KV for cross-session search.
- **Hub server init guard**: `server.ts` explicitly mkdirs `dataDir` before starting.
- **Choreographed coordinator**: `ChoreographedCoordinator` runs tasks as a linear pipeline;
  each task receives the previous task's output as additional context. Activated by `--comm-mode choreographed`.
- **Dynamic model lists**: `defaults.dynamic_models = true` in config queries Anthropic,
  OpenRouter, Ollama APIs at startup (2 s timeout, falls back to static lists per provider).
- **Remote agents — `--serve`**: headless HTTP mode exposing `GET /health`,
  `POST /agent/run` (SSE streaming), `POST /agent/reset`.
- **RemoteAgentTool**: `run_remote_agent` tool POSTs to a remote Pi3 `--serve` instance,
  reads SSE stream, returns accumulated text. Configurable timeout.
- **Setup wizard**: `--setup` flag runs an Ink-based API key wizard that stores keys in the
  platform keychain (macOS Keychain / libsecret / AES-256-GCM file). `resolveProviderKey`
  checks keychain after config file and before env vars.

---

## Next Tasks — Phase 5

**Typecheck after every file.** Full check before each commit:
```
for pkg in packages/bus packages/telemetry packages/hermes packages/providers packages/tools \
  packages/orchestrator packages/tui packages/hub packages/config packages/mcp apps/cli; do
  result=$(cd /Users/jeffblakely/Source/Pi3/$pkg && bunx tsc --noEmit 2>&1)
  [ -n "$result" ] && echo "FAIL $pkg:" && echo "$result" || echo "OK $pkg"
done
```

---

### Task 1 — Fix `--serve` concurrent session safety *(~20 min)* 🔴 Bug

**Problem:** `--serve` mode binds a single `Agent` instance to the HTTP server. Two simultaneous
`POST /agent/run` requests will interleave their turns into the same conversation history,
producing garbled output and corrupting agent state.

**File: `apps/cli/src/index.tsx` — serve handler**

Replace the single shared `agent` with a request-scoped agent created fresh per call:

```typescript
// In the /agent/run handler, create a fresh agent for each request
// (re-use the same provider/model/tools config, just a new Agent instance)
if (req.method === 'POST' && url.pathname === '/agent/run') {
  const reqAgent = new Agent({
    id: `serve-${Date.now()}`,
    name: 'swarm-serve',
    provider,
    model,
    tools: agentTools,
    systemPrompt: commSystemPrompt + memorySystemPrompt,
    workingDir,
    bus,
    sessionId: `serve-${Date.now()}`,
    registry,
  })
  // ... rest of SSE handler using reqAgent instead of agent
}
```

Alternatively, queue requests and run them serially against the shared agent. The per-request
approach is simpler and gives each remote caller a fresh context.

Commit: `fix(serve): per-request agent instances to prevent concurrent session corruption`

---

### Task 2 — `--serve` auth token *(~15 min)*

**Problem:** The HTTP server started by `--serve` has no authentication. Anyone on the same
network (or Internet if port-forwarded) can run arbitrary prompts against the agent.

**File: `packages/config/src/schema.ts`**

Add to the `hub` section (reuse hub config since serve is related infrastructure):
```toml
[hub]
serve_token = ""   # Bearer token required for --serve requests; empty = no auth
```

**File: `apps/cli/src/index.tsx` — serve handler**

```typescript
const serveToken = config.hub.serve_token || null

// In fetch handler, before routing:
if (serveToken) {
  const auth = req.headers.get('Authorization') ?? ''
  if (auth !== `Bearer ${serveToken}`) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
  }
}
```

**File: `packages/orchestrator/src/RemoteAgentTool.ts`**

Add optional `token` field to the input schema and pass it as an `Authorization` header.

Commit: `feat(serve): Bearer token auth for --serve + RemoteAgentTool token field`

---

### Task 3 — Memory read for hub-backed backends *(~25 min)*

**Problem:** `loadMemoryForDir` (startup memory injection) scans the local filesystem at
`handoffDir` for MEMORY\*.md files. This works for the `markdown` backend because the agent
writes files locally. But when using `agentsynapse` or `agentcognose` backends (hub-backed),
`onHandoffComplete` also stores the MEMORY.md content in the hub's KV store. On a new machine
or after clearing local files, the startup injection will find nothing even though the hub has
the memory.

**Design:** Add a `loadMemory(workingDir)` method to `MemoryProvider` that returns a
`LoadedMemory | null`. Each provider implements it differently:

- `MarkdownMemoryProvider.loadMemory(workingDir)` — delegates to the existing `loadMemoryForDir` on its `dataDir`
- `HubMemoryProvider.loadMemory(workingDir)` — searches KV namespace `workingDir` for key `latest_memory`, returns it
- `AgentSynapseProvider.loadMemory(workingDir)` — same HTTP call to hub

**File: `packages/hub/src/memory/MemoryProvider.ts`**

Add to interface:
```typescript
loadMemory(workingDir: string): Promise<LoadedMemory | null>
```

**Files to update:** All four provider implementations + `apps/cli/src/index.tsx` (replace
`loadMemoryForDir(handoffDir, workingDir)` with `memoryProvider.loadMemory(workingDir)`).

**File: `packages/hub/src/memory/MarkdownMemoryProvider.ts`**

On `onHandoffComplete`, also write the workingDir → latest memory mapping:
```typescript
// After files are on disk, store workingDir → memoryPath in KV
await this._memStore.set(files.workingDir, 'latest_memory_path', files.memoryPath)
```

Commit: `feat(memory): provider-level loadMemory() so hub backends serve startup injection`

---

### Task 4 — CommLog scroll support *(~20 min)*

**Problem:** CommLog currently shows the last `maxRows` messages with no way to scroll back.
In long swarm sessions with many inter-agent messages, earlier context is permanently lost
from the view.

**File: `packages/tui/src/CommLog.tsx`**

Add scroll state: `const [scrollOffset, setScrollOffset] = useState(0)`.

Wire `useInput` (already in scope via ink) to handle up/down arrows when CommLog is visible:
- Arrow up: `setScrollOffset(o => Math.min(o + 1, allItems.length - maxRows))`
- Arrow down: `setScrollOffset(o => Math.max(o - 1, 0))`

Slice `allItems` from `allItems.length - maxRows - scrollOffset` instead of the tail.

Add a scroll indicator to the header: `↑ 4 more` when scrolled down, `↓ scroll for more` when
at the top and there are items above.

**Props to add:** `isActive?: boolean` — only capture arrow keys when CommLog is focused/visible.

Commit: `feat(tui): CommLog scroll with arrow keys`

---

### Task 5 — Dynamic model filter for OpenRouter *(~10 min)*

**Problem:** OpenRouter returns 200+ models. `tryFetchModels` caps at 20 arbitrarily
(`d?.data?.slice(0, 20)`). This gives a random-ish first-20, not the most useful ones.

**File: `apps/cli/src/index.tsx` — `tryFetchModels`**

OpenRouter's model list includes `context_length` and optionally a `top_provider` flag.
Sort by context_length descending and prefer models with `id` matching known providers:

```typescript
.then((d: { data?: Array<{ id: string; context_length?: number }> } | null) => {
  if (!d?.data) return null
  return d.data
    .filter(m => m.id && m.context_length && m.context_length >= 8192)
    .sort((a, b) => (b.context_length ?? 0) - (a.context_length ?? 0))
    .slice(0, 30)
    .map(m => m.id)
})
```

Also add `defaults.dynamic_models_limit` config field (default 30) so users can tune it.

Commit: `feat(config): dynamic model list — filter by context length, configurable limit`

---

### Task 6 — Update `/help` and config schema comments *(~10 min)*

**Problem:** Several new features aren't documented in the TUI's `/help` output.

**File: `apps/cli/src/App.tsx` — `onCommand` `'help'` case**

Add to the help text:
```
  /skills           List skills  ·  /skill-name [args]  to invoke with {input}
Memory
  memory_search     Agent tool — search KV memory by keyword
  memory_read       Agent tool — read KV memory by key
Swarm flags
  --comm-mode choreographed   Linear pipeline (each task gets prior output)
  --serve [port]              Headless HTTP agent server (default 3001)
  --preset                    quality | fast | local | mixed | default
```

**File: `packages/config/src/schema.ts`**

Fix stale comment on `agentcognose` — it now says "stub, pending integration". Update to:
```typescript
// agentcognose — routes to AgentSynapse / external hub at agentsynapse_url
```

Commit: `docs(tui): update /help + fix stale schema comments`

---

## Key File Locations

| What | Where |
|---|---|
| Entry point | `apps/cli/src/index.tsx` |
| TUI state + handoff | `apps/cli/src/App.tsx` |
| Setup wizard | `apps/cli/src/wizard.tsx` |
| Bus types | `packages/bus/src/types.ts` |
| MessageBus | `packages/bus/src/MessageBus.ts` |
| AgentRegistry | `packages/bus/src/AgentRegistry.ts` |
| Agent | `packages/orchestrator/src/Agent.ts` |
| Coordinator (parallel) | `packages/orchestrator/src/Coordinator.ts` |
| ChoreographedCoordinator | `packages/orchestrator/src/ChoreographedCoordinator.ts` |
| RemoteAgentTool | `packages/orchestrator/src/RemoteAgentTool.ts` |
| WorkerPool | `packages/orchestrator/src/WorkerPool.ts` |
| Config schema | `packages/config/src/schema.ts` |
| Memory providers | `packages/hub/src/memory/` |
| loadMemoryForDir | `packages/hub/src/memory/loadMemory.ts` |
| MemorySearchTool, MemoryReadTool | `packages/hub/src/memory/MemoryTools.ts` |
| SkillStore | `packages/hub/src/skills/SkillStore.ts` |
| Hub server | `packages/hub/src/HubServer.ts` |
| Hub daemon entry | `packages/hub/src/server.ts` |
| Keychain | `packages/keychain/src/index.ts` |
| CommLog TUI | `packages/tui/src/CommLog.tsx` |
| Architecture doc | `ARCHITECTURE.md` |

---

## Config File Reference (~/.swarm/config.toml)

```toml
[defaults]
model = "claude-opus-4-6"
provider = "anthropic"
theme = "dark"
dynamic_models = false   # true = query provider APIs at startup for live model lists

[memory]
backend = "markdown"     # markdown | obsidian | agentsynapse | agentcognose
path = "~/.swarm/handoff"
context_threshold = 85

[hub]
port = 7777
persist = false
# serve_token = ""       # TODO Task 2 — Bearer auth for --serve

[communication]
format = "hermes"
mode = "orchestrated"    # orchestrated | choreographed | adhoc
```

---

## Important Rules

- **CC source** = reference only (proprietary). pi-mono + hermes-agent = free to use.
- All code must typecheck clean: `cd <package> && bunx tsc --noEmit`
- Check all packages after changes (full command above)
- Commit after each task, push after all are clean
- Never add error handling for impossible cases; never add speculative abstractions
