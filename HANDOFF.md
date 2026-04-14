# Pi3 Swarm — Handoff

**Date:** 2026-04-13  
**Repo:** https://github.com/megatronlabs/Pi3  
**Last commit:** dbaad58 — Add pluggable memory backend and configurable handoff threshold

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
  bus/          AgentMessage types, MessageBus (in-memory pub/sub, banter + fire-and-forget)
  telemetry/    OTEL-compatible structured logger → file + OTLP HTTP
  hermes/       Hermes XML format serializer/parser
  providers/    Anthropic, Ollama, OpenRouter, Replicate adapters
  tui/          Ink components: FullscreenLayout, MessageList, PromptInput, StatusLine,
                AgentPanel, CommLog, SlashMenu
  tools/        BashTool, FileRead/Write/Edit, Glob, Grep
  orchestrator/ Agent (bus-aware), QueryEngine, Coordinator, TaskGraph, WorkerPool,
                SwarmAgentTool, SendAgentMessageTool
  config/       ~/.swarm/config.toml schema + loaders
  hub/          MemoryProvider interface + MarkdownMemoryProvider, ObsidianMemoryProvider,
                AgentSynapseProvider (stub)
apps/
  cli/          Entry point (index.tsx) + App.tsx (TUI state) + adaptTool.ts
```

---

## Current State — What Works

- Full single-agent chat loop (streaming, tool use, multi-turn)
- Providers: Anthropic, Ollama (tested with gemma3:4b), OpenRouter, Replicate  
- Tools: bash, file_read, file_write, file_edit, glob, grep  
- Slash commands: /clear /compact /config /exit /help /mcp /model /preset /status /training-wheels  
- Ctrl+W = AgentPanel (swarm workers), Ctrl+L = CommLog (inter-agent messages), Ctrl+C = exit  
- `send_agent_message` tool on every agent: banter (query + await_reply=true) + fire-and-forget (vote/status/result)  
- MessageBus pub/sub in-memory; CommLog panel shows live message stream  
- Telemetry wired to bus monitor → ~/.swarm/logs/swarm.log + optional OTLP  
- Memory handoff at configurable context % (default 85); backend = markdown | obsidian | agentsynapse (stub)  
- Model roles + presets system (quality / fast / local / mixed)  
- Training wheels mode (no bash, path containment, write approval)  

---

## Next Task — Pi-Messenger Pattern Additions

Learned from https://github.com/nicobailon/pi-messenger. All changes are in `@swarm/bus`  
(+ small wiring in `@swarm/orchestrator` Agent.ts and `apps/cli` index.tsx).  
**Run typecheck after each task:** `cd packages/bus && bunx tsc --noEmit`

### Task 1 — `replyTo` field *(~5 min)*

File: `packages/bus/src/types.ts`  
- Add `replyTo?: string` to `AgentMessage` interface (threads any message off any other, more general than `correlationId` which is banter-only)  
- Add `replyTo?: string` to `createMessage()` opts  

File: `packages/orchestrator/src/SendAgentMessageTool.ts`  
- Add `reply_to: z.string().optional()` to input schema  
- Pass `replyTo: input.reply_to` in the `createMessage()` call  

### Task 2 — Message budget *(~15 min)*

File: `packages/config/src/schema.ts`  
- Add to `communication` section: `max_messages_per_session: z.number().int().positive().default(500)`  

File: `packages/bus/src/MessageBus.ts`  
- Add `MessageBusOptions { inboxDir?: string; maxMessages?: number }` interface  
- Update constructor to accept `MessageBusOptions`  
- Add `private _messageCount = 0`  
- In `publish()` and `banter()`: increment counter; if `>= maxMessages`, throw `new BusCapacityError()`  
- Export `BusCapacityError extends Error` from the package  

File: `apps/cli/src/index.tsx`  
- Pass `maxMessages: config.communication.max_messages_per_session` to `new MessageBus({ maxMessages })`  

### Task 3 — Inbox persistence *(~30 min)*

Goal: after in-memory delivery, also write `~/.swarm/inbox/<agentId>/<ts>-<id>.json`  
using atomic temp-file→rename (prevents corruption from concurrent agent writes).

File: `packages/bus/src/MessageBus.ts`  
- Add `inboxDir?: string` to `MessageBusOptions`  
- After `_route(msg)`, call `this._persistToInbox(msg)` (fire-and-forget, never throws)  
- `_persistToInbox(msg)`:  
  1. If no `inboxDir`, return  
  2. Target dir: `<inboxDir>/<msg.to>/` (skip if `msg.to === 'all'` — write to each subscriber's dir instead)  
  3. Filename: `${Date.now()}-${msg.id}.json`  
  4. Atomic write: write to `<filename>.tmp` then `fs.rename()` to final path  
- Add `readInbox(agentId: string): Promise<AgentMessage[]>` — reads + JSON-parses all files in `<inboxDir>/<agentId>/`, sorted by filename (chronological)  
- Add `clearInbox(agentId: string): Promise<void>` — deletes all files in that dir  

File: `packages/config/src/schema.ts`  
- Add `communication.inbox_dir: z.string().default('~/.swarm/inbox')`  

File: `apps/cli/src/index.tsx`  
- Pass `inboxDir: expandPath(config.communication.inbox_dir)` to `new MessageBus({ ... })`  

### Task 4 — Agent registry *(~30 min)*

Goal: discoverable agents with presence. Agents register on startup, update each turn.  
Status is computed from `lastActiveAt` timestamp — no heartbeats.

File: `packages/bus/src/AgentRegistry.ts` *(new)*  
```typescript
export interface RegistryEntry {
  id: string
  name: string
  model: string
  provider: string
  pid: number
  sessionId: string
  workingDir: string
  lastActiveAt: string   // ISO 8601
  messageCount: number
  status?: 'active' | 'idle' | 'away'  // computed on read, not stored
}

export class AgentRegistry {
  constructor(private registryPath: string) {}
  async register(entry: Omit<RegistryEntry, 'status'>): Promise<void>  // atomic write
  async update(id: string, patch: Partial<RegistryEntry>): Promise<void>
  async list(): Promise<RegistryEntry[]>   // reads file, computes status from lastActiveAt
  async remove(id: string): Promise<void>
}
// Status thresholds: active = <30s, idle = 30s–5min, away = >5min
```
Use atomic temp→rename for all writes.  

File: `packages/bus/src/index.ts`  
- Export `AgentRegistry` and `RegistryEntry`  

File: `packages/orchestrator/src/Agent.ts`  
- Add `registry?: AgentRegistry` to `AgentConfig`  
- In constructor: call `registry.register({ id, name, model, ... })` (fire-and-forget)  
- In `run()` after the loop ends: call `registry.update(id, { lastActiveAt: new Date().toISOString(), messageCount: ... })`  
- In `dispose()`: call `registry.remove(id)`  

File: `apps/cli/src/index.tsx`  
- Create `new AgentRegistry(expandPath('~/.swarm/agents/registry.json'))`  
- Pass to `new Agent({ ..., registry })`  
- On process exit (`process.on('exit', ...)`): `registry.remove('main')`  

---

## Important Rules

- **CC source** = reference only (proprietary). pi-mono + hermes-agent = free to use.
- All code must typecheck clean: `cd <package> && bunx tsc --noEmit`
- Check all 10 packages after changes: bus, telemetry, hermes, providers, tools, orchestrator, tui, hub, config, apps/cli
- Commit after each task, push after all 4 are clean

---

## Config File Reference (~/.swarm/config.toml)

```toml
[defaults]
model = "claude-opus-4-6"
provider = "anthropic"

[communication]
format = "hermes"
mode = "orchestrated"
await_reply_timeout_ms = 30000
max_messages_per_session = 500    # Task 2
inbox_dir = "~/.swarm/inbox"      # Task 3

[memory]
backend = "markdown"
path = "~/.swarm/handoff"
context_threshold = 85

[telemetry]
enabled = true
log_file = "~/.swarm/logs/swarm.log"

[hub]
port = 7777
persist = false
```

---

## Key File Locations

| What | Where |
|---|---|
| Entry point | `apps/cli/src/index.tsx` |
| TUI state + handoff | `apps/cli/src/App.tsx` |
| Bus types | `packages/bus/src/types.ts` |
| MessageBus | `packages/bus/src/MessageBus.ts` |
| Agent | `packages/orchestrator/src/Agent.ts` |
| send_agent_message tool | `packages/orchestrator/src/SendAgentMessageTool.ts` |
| Config schema | `packages/config/src/schema.ts` |
| Memory providers | `packages/hub/src/memory/` |
| CommLog TUI | `packages/tui/src/CommLog.tsx` |
| StatusLine | `packages/tui/src/StatusLine.tsx` |
| Handoff prompt | `apps/cli/src/App.tsx` — `buildHandoffPrompt()` |
