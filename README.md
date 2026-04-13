# 🧠 Pi3

A multi-agent AI terminal built on Ink v6, React 19, and Bun. Pi3 gives you a full coding agent in a terminal UI — file reading, editing, bash, search — across any provider: Anthropic, Ollama, OpenRouter, Replicate. Run one agent or orchestrate a swarm of them in parallel.

---

## Features

- **Multi-provider** — Anthropic, Ollama (local), OpenRouter, Replicate. Switch with a flag.
- **Hermes tool-calling** — universal tool protocol for open-weight models that don't support native function calling. XML + bare JSON fallback.
- **Built-in tools** — Bash, FileRead, FileWrite, FileEdit, Glob, Grep.
- **Swarm mode** — main agent can spawn sub-agents via `spawn_agent` tool. Parallel task execution with a live AgentPanel overlay.
- **Context window meter** — live `████░░░░░░ 34% 🤔` bar in the status line, colored by fill level. Auto-triggers a Handoff Transcript at 85%.
- **Slash commands** — `/clear`, `/compact`, `/status`, `/config`, `/model`, `/help`, `/exit`, `/mcp`, `/training-wheels`. Tab to autocomplete.
- **Model roles + presets** — assign different models to different tasks (chat, coding, planning, reasoning, orchestration, image, video, summarization, search). Switch between built-in presets (`quality`, `fast`, `local`, `mixed`) or define your own in config.
- **Training wheels mode** — restricts the agent to read-only within the working directory. Writes require explicit user approval.
- **Tokyo Night theme** — dark only for v1.

---

## Requirements

- [Bun](https://bun.sh) v1.1+
- Node 20+ (for type checking)
- An Ollama install for local models, or an API key for cloud providers

---

## Install

```bash
git clone https://github.com/megatronlabs/Pi3.git
cd Pi3
bun install
```

---

## Setup

```bash
# Generate config file at ~/.swarm/config.toml
bun run apps/cli/src/index.tsx --init-config
```

Edit `~/.swarm/config.toml` to set your default model, provider, and API keys.

---

## Usage

```bash
# Ollama — no key needed
bun run apps/cli/src/index.tsx -p ollama -m gemma3:4b

# Better tool use with a larger local model
ollama pull qwen2.5:7b
bun run apps/cli/src/index.tsx -p ollama -m qwen2.5:7b

# Anthropic
export ANTHROPIC_API_KEY=sk-ant-...
bun run apps/cli/src/index.tsx

# OpenRouter
export OPENROUTER_API_KEY=sk-or-...
bun run apps/cli/src/index.tsx -p openrouter -m mistralai/mistral-large

# Swarm mode — agent can spawn sub-agents
bun run apps/cli/src/index.tsx --swarm

# Training wheels — read-only, writes require approval
bun run apps/cli/src/index.tsx --training-wheels
```

---

## Slash Commands

Type `/` to open the command menu. Arrow keys to navigate, Tab to autocomplete, Enter to execute.

| Command | Description |
|---|---|
| `/clear` | Clear chat history and reset context meter |
| `/compact` | Compact conversation history to free context |
| `/config` | Show working directory, config path, model, provider |
| `/exit` | Exit Pi3 |
| `/help` | List all commands and keybindings |
| `/mcp` | MCP server status |
| `/model` | Switch provider / model |
| `/status` | Session status — context %, token count, history length |
| `/training-wheels` | Show training wheels status |

---

## Keybindings

| Key | Action |
|---|---|
| `Enter` | Submit message |
| `Escape` | Clear input |
| `Ctrl+W` | Toggle agent panel (swarm mode) |
| `Ctrl+C` | Exit |

---

## Context Window Meter

The status bar shows a live context fill meter:

```
█░░░░░░░░░ ..%        ← waiting for first response
██░░░░░░░░  14% 🙂    ← green  (0–39%)
████░░░░░░  42% 😬    ← yellow (40–69%)
███████░░░  72% 😰    ← orange (70–78%)
█████████░  81% 😱    ← red    (79%+)
██████████  87% 💀    ← skull  (85%+, handoff triggered)
```

At **85%** the agent automatically composes a Handoff Transcript and Memory file to `~/.swarm/handoff/`, so the next session can continue seamlessly.

---

## Model Roles & Presets

Each task type can use a different model. Configure roles in `~/.swarm/config.toml` or switch presets at startup with `--preset`.

| Role | Purpose |
|---|---|
| `chat` | General conversation |
| `coding` | Code generation, editing, debugging |
| `planning` | Architecture, task decomposition |
| `reasoning` | Deep analysis, complex multi-step problems |
| `orchestration` | Coordinator / swarm spawner |
| `image` | Image generation |
| `video` | Video generation |
| `summarization` | Compaction, document summarization |
| `search` | Web search augmented tasks |

**Built-in presets:**

| Preset | Description |
|---|---|
| `default` | Use `[roles]` section or `defaults.model` for everything |
| `quality` | Best-in-class cloud models per role (Opus for planning, Sonnet for coding) |
| `fast` | Fastest / cheapest cloud models across all roles |
| `local` | Fully local — all roles use Ollama |
| `mixed` | Local for chat/orchestration, cloud for coding/planning |

```bash
bun run apps/cli/src/index.tsx --preset quality
bun run apps/cli/src/index.tsx --preset local
```

Define your own preset in `~/.swarm/config.toml`:

```toml
[presets.mypreset]
chat          = { model = "qwen2.5:7b", provider = "ollama" }
coding        = { model = "claude-sonnet-4-6", provider = "anthropic" }
planning      = { model = "claude-opus-4-6", provider = "anthropic" }
orchestration = { model = "qwen2.5:3b", provider = "ollama" }
```

Use `/preset` in the TUI to view the active preset and all role assignments.

---

## Training Wheels

Start with `--training-wheels` to sandbox the agent:

- **Bash disabled** entirely
- **All file access** restricted to the working directory
- **Writes blocked** by default — agent must ask, you approve by replying yes / go ahead / allow
- Status bar shows `🎓 training wheels` in amber

---

## Architecture

```
Pi3/
├── apps/cli/          Commander CLI + Ink TUI (App.tsx, index.tsx)
├── packages/
│   ├── tui/           Ink components: FullscreenLayout, MessageList,
│   │                  PromptInput (slash commands), StatusLine, AgentPanel
│   ├── orchestrator/  QueryEngine, Agent, TaskGraph, WorkerPool,
│   │                  Coordinator, SwarmAgentTool
│   ├── providers/     Anthropic, Ollama, OpenRouter, Replicate adapters
│   │                  + Hermes format (serializer, parser, zodToHermes)
│   ├── tools/         Bash, FileRead, FileWrite, FileEdit, Glob, Grep
│   └── config/        ~/.swarm/config.toml loader (smol-toml + Zod)
```

**Tool call flow:**
```
User input → Agent.run() → QueryEngine.turn() → Provider.stream()
  → StreamEvents (text, tool_call, usage, done)
  → Tool execution → tool results → next loop iteration
  → TurnEvents → App.tsx state → Ink re-render
```

---

## Roadmap

| Phase | Status |
|---|---|
| 1 — TUI shell (layout, input, streaming, tools) | ✅ Complete |
| 2 — Multi-provider (OpenRouter, Replicate, Hermes) | ✅ Complete |
| 3 — Swarm (TaskGraph, WorkerPool, Coordinator) | ✅ Complete |
| 4 — MCP server integration | ⬜ Planned |
| 4 — Skill auto-creation (hermes-agent pattern) | ⬜ Planned |
| 4 — Remote agents (Linux box via Ollama) | ⬜ Planned |

---

## Known Model Quirks

- **gemma3:4b** — small model, may call tools on casual questions. Try `qwen2.5:7b` for better tool use.
- **Hermes mode** — full response is buffered before parsing (no mid-stream output). Fast for small local models.
- **Tool reliability** — scales with model size. 7B+ models follow Hermes format reliably.

---

## License

MIT
