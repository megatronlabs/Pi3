# Swarm — Multi-Agent TUI Plan

A Claude Code-inspired terminal UI for orchestrating multiple AI agents across multiple LLM providers.

## Vision

A TUI application that lets you run a swarm of AI agents — each with its own model, provider, and tool set — coordinated by an orchestrator that assigns tasks, tracks a dependency graph, and streams results back to a unified terminal interface. Think Claude Code's UX, but open-provider and multi-agent first.

---

## Constraints

- **Cannot use CC source code** — Claude Code (`/Users/jeffblakely/Source/CC/`) is proprietary. Use only as UX/architecture reference.
- **Can use CC's open-source dependencies** — Ink v6, React 19, Bun, Zod, chalk, etc. are all MIT licensed.
- **Can use pi-mono freely** — https://github.com/badlogic/pi-mono (MIT)
- **Can use hermes-agent freely** — https://github.com/NousResearch/hermes-agent (MIT)

---

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Runtime | Bun | Fast startup, native TypeScript, workspace support |
| TUI Framework | Ink v6 + React 19 | Same as CC — proven terminal React renderer |
| Styling | chalk v5, figures | ANSI colors, unicode box-drawing |
| Validation | Zod | Tool input schemas |
| Markdown/Code | marked, highlight.js | Message rendering |
| LLM Providers | pi-ai (extended) | From pi-mono — covers Anthropic, OpenAI, Gemini, Mistral, Bedrock, Azure |
| Agent Loop | pi-agent-core (extended) | From pi-mono — tool calling, session state |
| Tool Format | Hermes parser (TS port) | Port from hermes-agent Python — universal tool-calling across open-weight models |
| Inter-Agent | ACP protocol | From hermes-agent — structured agent-to-agent messaging |

---

## Monorepo Structure

```
Pi3/
├── packages/
│   ├── tui/              # Ink/React components — the terminal UI
│   ├── providers/        # LLM adapters extending pi-ai
│   ├── tools/            # Built-in tools: Bash, File, Web, Agent, MCP
│   ├── orchestrator/     # Swarm coordinator, task graph, worker pool
│   └── hermes/           # Hermes tool format (TypeScript port from hermes-agent)
├── apps/
│   └── cli/              # Entry point: Commander CLI → boots TUI or headless
├── plan.md
├── progress.md
├── bun.workspace.toml
└── tsconfig.base.json
```

---

## Component Architecture (TUI)

Inspired by CC's layout, built originally with Ink v6 + React 19:

```
App
└── ThemeProvider (dark/light)
    └── AppStateProvider (global state via useSyncExternalStore)
        └── REPL
            ├── FullscreenLayout
            │   ├── AgentPanel (swarm view — active workers, tasks)
            │   ├── ScrollBox (scrollable message history)
            │   │   └── VirtualMessageList
            │   │       ├── UserMessage
            │   │       ├── AssistantMessage
            │   │       ├── ToolUseMessage
            │   │       ├── ToolResultMessage
            │   │       ├── ThinkingMessage
            │   │       └── ErrorMessage
            │   ├── PromptInput (multi-line, history, slash commands)
            │   └── StatusLine (model · provider · cost · agent count)
            └── Dialogs (permissions, settings, plan approval)
```

---

## Provider Interface

All LLM backends implement a single streaming interface:

```typescript
interface Provider {
  id: string  // 'anthropic' | 'openrouter' | 'replicate' | 'ollama' | 'bedrock'
  models(): Promise<string[]>
  stream(
    model: string,
    messages: Message[],
    tools: ToolSchema[],
    opts: StreamOpts
  ): AsyncIterable<StreamEvent>
}

type StreamEvent =
  | { type: 'text';       delta: string }
  | { type: 'tool_call';  id: string; name: string; input: unknown }
  | { type: 'thinking';   delta: string }
  | { type: 'done';       stop_reason: string }
```

### Supported Providers

| Provider | Models | Notes |
|---|---|---|
| Anthropic | Claude 3.x, Claude 4.x | Native streaming SDK |
| OpenRouter | 200+ models | OpenAI-compatible REST |
| Replicate | Open-weight models | SSE streaming |
| Ollama | Local models | localhost or remote Linux box |
| Bedrock | Claude on AWS | Via pi-ai |

---

## Tool System

Each tool is a typed, Zod-validated unit:

```typescript
interface Tool<Input, Output, Progress = void> {
  name: string
  description: string
  inputSchema: ZodType<Input>
  call(
    input: Input,
    ctx: ToolContext,
    onProgress?: (p: Progress) => void
  ): Promise<Output>
  isConcurrencySafe(input: Input): boolean
  isDestructive?(input: Input): boolean
}
```

### Built-in Tools (Phase 1)

- `BashTool` — execute shell commands with timeout + approval gating
- `FileReadTool` — read files with line ranges
- `FileWriteTool` — write/create files
- `FileEditTool` — surgical string replacement
- `GlobTool` — file pattern search
- `GrepTool` — content search
- `WebSearchTool` — web search
- `AgentTool` — spawn a worker agent with a task

### Phase 2+ Tools

- `MCPTool` — dynamic tools from MCP servers
- `ReplicateTool` — run Replicate models as tools
- `SkillTool` — invoke learned/stored skills (hermes-agent pattern)

---

## Swarm Architecture

```
Orchestrator
├── TaskGraph (DAG — tasks with dependency edges)
├── WorkerPool
│   ├── Worker { id, model, provider, agent, status, messages }
│   ├── Worker { ... }
│   └── Worker { ... }
└── MessageBus (EventEmitter — no shared state between workers)
    ├── task:assigned → Worker
    ├── task:progress → Orchestrator → TUI
    └── task:complete → Orchestrator → unblock dependents
```

Workers are fully isolated: each has its own `Agent` instance (own QueryEngine, own Provider, own tool set). The Orchestrator only passes task descriptions and receives structured results. Workers cannot directly access each other's state.

### Hermes Tool Format

For open-weight models (Ollama, Replicate, OpenRouter non-OpenAI models), tools are serialized in Hermes format before sending and responses are parsed with the Hermes parser:

```typescript
// packages/hermes
export function toHermesSystemPrompt(tools: ToolSchema[]): string
export function parseHermesToolCall(text: string): ToolCall | null
export function toHermesMessages(messages: Message[]): string
```

---

## Phases

### Phase 1 — TUI Shell *(start here)*

**Goal:** Working single-agent TUI. Chat, streaming, tool use, looks like CC.

- [ ] Sprint 1: Monorepo scaffold (Bun workspaces, tsconfig, deps)
- [ ] Sprint 2: TUI layout — FullscreenLayout, ScrollBox, PromptInput, StatusLine
- [ ] Sprint 3: Provider layer — Anthropic + Ollama adapters
- [ ] Sprint 4: Agent loop — QueryEngine, streaming, message state
- [ ] Sprint 5: Built-in tools — Bash, File, Glob, Grep
- [ ] Sprint 6: Tool rendering in TUI — ToolUseMessage, approval dialogs

### Phase 2 — Multi-Provider

**Goal:** Seamlessly switch models/providers per session or per agent.

- [x] OpenRouter adapter
- [x] Hermes format for open-weight models
- [ ] Replicate adapter — SSE streaming, Replicate prediction API
- [ ] Config system — `packages/config`, reads `~/.swarm/config.toml` (smol-toml), Zod schema
- [ ] Provider/model picker — interactive TUI overlay (arrow keys, enter)

### Phase 3 — Swarm ✅ Complete

- [x] `TaskGraph` — DAG, `getReadyTasks()`, deadlock detection, full status lifecycle
- [x] `WorkerPool` — busy/idle tracking, `assignTask`/`releaseWorker`, `getStatus()`
- [x] `Coordinator` — EventEmitter, `Promise.race` loop, concurrent task execution, deadlock guard
- [x] `SwarmAgentTool` — `spawn_agent` tool, provider/model override, result accumulation
- [x] `AgentPanel` — per-worker braille spinners, task summary, integrated into FullscreenLayout
- [x] CLI `--swarm` flag, `Ctrl+W` panel toggle, coordinator event wiring in App.tsx

### Phase 4 — Advanced

- [ ] MCP server integration
- [ ] Skill auto-creation (hermes-agent pattern)
- [ ] Voice input
- [ ] Remote agents (Linux box via SSH/REST)
- [ ] Web UI companion (pi-web-ui)

---

## Config Schema

```toml
# ~/.swarm/config.toml

[defaults]
model = "claude-opus-4-6"
provider = "anthropic"
theme = "dark"

[providers.anthropic]
api_key = "$ANTHROPIC_API_KEY"

[providers.openrouter]
api_key = "$OPENROUTER_API_KEY"
base_url = "https://openrouter.ai/api/v1"

[providers.ollama]
base_url = "http://192.168.1.100:11434"  # local Linux box

[providers.replicate]
api_key = "$REPLICATE_API_KEY"
```

---

## Key Design Decisions

1. **Ink v6 + React 19** — same OSS deps as CC, proven TUI pattern, component-based
2. **pi-ai as provider base** — don't reinvent provider abstraction, extend what exists
3. **Hermes format as universal tool protocol** — works across ALL model families
4. **No shared state between workers** — isolation by design, communicate via messages only
5. **Stream-first everywhere** — all API calls stream, all tool progress streams, all agent output streams
6. **Bun** — fast startup, native TS, workspace support, matches CC toolchain
