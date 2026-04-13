# Swarm — Build Progress

Tracking active work, decisions made, and what's next.

---

## Status: Running ✅ — Tested live on Ollama gemma3:4b, 7/7 packages typecheck clean

---

## Session Log

### 2026-04-12 — Architecture, Build, Testing

**Architecture decisions:**
- CC source = reference only (proprietary). Same OSS deps (Ink v6, React 19, Bun, Zod) are fine.
- pi-mono + hermes-agent = use freely
- Ink v6 + React 19 + Bun runtime (same stack as CC)
- Hermes format as universal tool protocol for open-weight models
- `~/.swarm/config.toml` for global config (smol-toml)
- Dark theme only for v1

**Built (all typechecking clean):**
- Monorepo scaffolded: 7 packages + 1 app, 49+ TypeScript source files
- All phases 1–3 completed in one session
- Live tested against Ollama gemma3:4b on Mac Mini M4

**Runtime bugs found and fixed during testing:**
1. Ink version conflict — `apps/cli` had `ink@7.0.0`, `packages/tui` uses `ink@^6.0.0`. Fixed by pinning cli to `^6.0.0`.
2. `useInput` implicit `any` — added explicit `(input: string, key: Key)` types.
3. Ollama 400 "does not support tools" — added Hermes fallback: buffers full response, parses `<tool_call>` XML tags.
4. `<tool_call` partial tag leaking as text — fixed by buffering entire response before parsing.
5. Bare JSON fallback — models emitting `{"name":"bash","arguments":{}}` without XML tags now parsed correctly.
6. Tool input display — `$ { "command": "..." }` → `$ echo 'hello'`, file path for file tools, etc.
7. Model looping after tool use — tool results were sent as `role: 'tool'` (native format), model ignored them. Fixed: Hermes mode now wraps results in `<tool_response>` tags as `role: 'user'` messages.
8. `assistant:` prefix bleed-through — model echoing Hermes format prefix into response. Stripped with regex in Hermes stream path.
9. AssistantMessage empty shell — tool-only turns were rendering an empty "assistant" label. Fixed: skip render if no text/thinking blocks.

---

## Phase 1 — TUI Shell ✅ Complete

| Sprint | Task | Status |
|---|---|---|
| 1 | Bun monorepo scaffold | ✅ 106 pkgs, all workspaces linked |
| 2 | FullscreenLayout + ScrollBox + StatusLine | ✅ Tokyo Night theme, braille spinner |
| 3 | PromptInput | ✅ ❯ prefix, blinking cursor, Enter/Esc/Ctrl+C |
| 4 | Provider layer | ✅ Anthropic, Ollama, OpenRouter + registry |
| 5 | QueryEngine + streaming agent loop | ✅ multi-turn tool use, history, compact |
| 6 | Message components | ✅ User, Assistant, ToolUse (spinner/tick/cross) |
| 7 | Built-in tools | ✅ Bash, FileRead/Write/Edit, Glob, Grep |
| 8 | Tool rendering | ✅ clean input display per tool type |

## Phase 2 — Multi-Provider ✅ Complete

| Task | Status |
|---|---|
| OpenRouter adapter | ✅ SSE streaming, tool call delta accumulation |
| Replicate adapter | ✅ OpenAI-compat primary, prediction SSE fallback |
| Hermes format (TS port) | ✅ serializer, parser (XML + bare JSON fallback), zodToHermes |
| Provider/model picker in TUI | ✅ Picker, ModelPicker (2-step), overlay support |
| Config file (~/.swarm/config.toml) | ✅ smol-toml, Zod schema, resolveProviderKey |
| CLI config integration | ✅ --init-config, per-provider key validation, config defaults |

## Phase 3 — Swarm ✅ Complete

| Task | Status |
|---|---|
| TaskGraph (DAG) | ✅ getReadyTasks, deadlock detection, full status lifecycle |
| WorkerPool | ✅ busy/idle tracking, assignTask/releaseWorker |
| Coordinator | ✅ EventEmitter, Promise.race loop, concurrent tasks |
| SwarmAgentTool | ✅ spawn_agent tool, provider/model override |
| AgentPanel TUI | ✅ per-worker spinners, task summary, FullscreenLayout |
| CLI wiring | ✅ --swarm flag, Ctrl+W panel toggle, coordinator events |

## Phase 4 — Advanced

| Task | Status |
|---|---|
| MCP server integration | ⬜ not started |
| Skill auto-creation (hermes-agent pattern) | ⬜ not started |
| Remote agents (Linux box via Ollama) | ⬜ not started |

---

## Known Model Quirks (not code bugs)

- **gemma3:4b** — small model, calls tools unnecessarily on casual questions. Better: `qwen2.5:3b`, `llama3.2:3b`
- **Hermes mode is non-streaming** — full response buffered before emitting (required for tag parsing). Fast for small local models.
- **Tool use reliability** — varies by model. Larger models (7B+) follow Hermes format much more reliably.

---

## How to Run

```bash
# First time setup
bun run apps/cli/src/index.tsx --init-config
# Edit ~/.swarm/config.toml to set default model/provider

# Ollama (no key needed — gemma3:4b already installed)
bun run apps/cli/src/index.tsx -p ollama -m gemma3:4b

# Better tool use with a larger model
ollama pull qwen2.5:7b
bun run apps/cli/src/index.tsx -p ollama -m qwen2.5:7b

# Anthropic
export ANTHROPIC_API_KEY=sk-ant-...
bun run apps/cli/src/index.tsx

# OpenRouter
export OPENROUTER_API_KEY=sk-or-...
bun run apps/cli/src/index.tsx -p openrouter -m mistralai/mistral-large

# Swarm mode (main agent can spawn sub-agents)
bun run apps/cli/src/index.tsx --swarm

# Keybindings
# Ctrl+W  — toggle AgentPanel (live swarm worker view)
# Ctrl+C  — exit
```

---

## Decisions

| Question | Decision | Rationale |
|---|---|---|
| pi-mono packages | Install from npm | Cleaner deps, easier updates |
| Hermes parser | Port Python → TypeScript | No Python runtime dep, no subprocess overhead |
| Config location | `~/.swarm/config.toml` | Global, single source of truth |
| Theme | Dark only (v1) | Simpler, toggle later |
| Hermes tool results | `<tool_response>` in user message | `role: 'tool'` ignored by non-native models |

---

## Build Timeline
- 2026-04-12 — Architecture, full build (Phases 1–3), live testing, bug fixes
- 2026-04-13 — Final bug fixes: tool result looping, assistant label, AssistantMessage empty shell
