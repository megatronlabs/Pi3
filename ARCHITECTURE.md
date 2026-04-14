# Pi3 Architecture

Multi-agent AI terminal built on Bun + Ink v6 + React 19. This document describes the system through seven diagrams, from package structure down to individual data flows.

---

## 1. Package Dependency Graph

```mermaid
graph LR
    cli["apps/cli"]
    orch["@swarm/orchestrator"]
    tui["@swarm/tui"]
    bus["@swarm/bus"]
    hub["@swarm/hub"]
    mcp["@swarm/mcp"]
    config["@swarm/config"]
    telemetry["@swarm/telemetry"]
    tools["@swarm/tools"]
    providers["@swarm/providers"]
    hermes["@swarm/hermes"]

    cli --> orch
    cli --> bus
    cli --> tui
    cli --> hub
    cli --> mcp
    cli --> config
    cli --> providers
    cli --> telemetry
    cli --> tools

    orch --> bus
    orch --> providers

    tui --> bus

    telemetry --> bus
```

Leaf packages (`bus`, `hub`, `mcp`, `config`, `tools`, `providers`, `hermes`) have no internal workspace dependencies.

---

## 2. Single-Agent Chat Flow

What happens from the moment the user presses Enter until the response is fully rendered.

```mermaid
sequenceDiagram
    participant U as User
    participant PI as PromptInput
    participant App as App.tsx
    participant A as Agent
    participant QE as QueryEngine
    participant P as Provider (stream)

    U->>PI: type + submit
    PI->>App: onSubmit(text)
    App->>App: add user ChatMessage to state
    App->>App: setIsStreaming(true)
    App->>A: agent.run(text)
    A->>A: drain _pendingMessages → prepend to prompt
    A->>QE: engine.turn(fullPrompt)
    QE->>P: provider.stream(messages, tools)
    P-->>QE: token stream (text / tool_use / usage / done)
    QE-->>A: yield TurnEvent
    A-->>App: yield TurnEvent (async iterable)

    loop drainAgentRun
        App->>App: text → update MessageList
        App->>App: tool_start → append tool_use block
        App->>App: tool_done → mark status done/error
        App->>App: usage → setContextTokens
        App->>App: done → setIsStreaming(false)
    end
```

---

## 3. Swarm Mode Flow

How a single user prompt becomes a parallel multi-agent execution.

```mermaid
sequenceDiagram
    participant U as User
    participant App as App.tsx
    participant A as Agent (main)
    participant TG as TaskGraph
    participant WF as workerFactory
    participant C as Coordinator
    participant W as Workers (1…N)
    participant AP as AgentPanel TUI

    U->>App: onSubmit(prompt)
    App->>TG: new TaskGraph()
    App->>A: appendTools([SwarmAddTaskTool, SwarmRunTool])
    App->>A: agent.run(prompt)

    loop decomposition turn
        A-->>App: tool_start: swarm_add_task
        App->>TG: graph.addTask(id, title, desc, dependsOn)
        A-->>App: tool_start: swarm_run
        App->>App: SwarmRunTool.onRun() callback fires
    end

    App->>WF: workerFactory(taskCount) → WorkerPool
    App->>C: new Coordinator(graph, pool)
    App->>App: setCoordinator(coord)
    App->>C: coord.run()

    loop scheduler loop
        C->>TG: getReadyTasks()
        C->>C: pair tasks with idle workers
        C->>W: worker.agent.run(task.description)
        W-->>C: TurnEvents (text/done/error)
        C->>TG: updateStatus(done|error)
        C-->>App: emit CoordinatorEvent
        App->>AP: setWorkers / setTaskSummary
    end

    C-->>App: emit swarm_complete
    App->>AP: setWorkers([])
```

---

## 4. Inter-Agent Messaging (Bus + Inbox)

Two delivery paths exist: in-process for agents within the same session, and cross-process for agents in separate sessions.

```mermaid
flowchart TD
    subgraph IN["In-process (same session)"]
        A1["Agent A\n(send_agent_message tool)"]
        SAM["SendAgentMessageTool"]
        MB["MessageBus\npublish() / banter()"]
        SUB["subscriber handler\n(registered at Agent construction)"]
        PM["Agent B._pendingMessages"]
        NEXT["Agent B.run() — next turn\ninjects queued messages"]

        A1 -->|calls| SAM
        SAM -->|bus.publish(msg) or bus.banter(msg)| MB
        MB -->|_route(msg) → handler| SUB
        SUB -->|push| PM
        PM -->|prepended to prompt| NEXT
    end

    subgraph BANTER["Banter (query + reply)"]
        Q["Agent A\nbanter(queryMsg)"]
        PB["_pendingBanter Map\nkeyed by msg.id"]
        REP["Agent B publishes\ntype=reply, correlationId=msg.id"]
        RES["Promise resolves\nwith reply message"]

        Q -->|registers Promise| PB
        REP -->|publish resolves| PB
        PB --> RES
    end

    subgraph XP["Cross-process (different sessions)"]
        A2["Agent A\n(external process)"]
        MB2["MessageBus.publish()"]
        PERSIST["_persistToInbox()\natomic tmp→rename"]
        INBOX["~/.swarm/inbox/main/\n{ts}-{id}.json"]
        POLL["App.tsx setInterval 2s\nbus.readInbox('main')"]
        INJECT["agent.injectMessage(msg)\ndeduped by seenIds Set"]

        A2 --> MB2
        MB2 --> PERSIST
        PERSIST --> INBOX
        INBOX -->|file read| POLL
        POLL --> INJECT
    end
```

---

## 5. Memory & Handoff Flow

How the agent preserves context across sessions, and how skills persist between runs.

```mermaid
flowchart TD
    subgraph HANDOFF["Context handoff"]
        CTX["contextPct >= threshold\n(default 85%)"]
        NOTICE["App shows notice message"]
        HP["agent.run(buildHandoffPrompt)"]
        FW["Agent uses file_write tool\nHANDOFF.md + MEMORY.md\nto handoffDir"]
        MP["memoryProvider.onHandoffComplete(files)"]

        CTX --> NOTICE
        NOTICE --> HP
        HP --> FW
        FW --> MP

        MP -->|backend=markdown| MDB["MarkdownMemoryProvider\nno-op (files already on disk)"]
        MP -->|backend=obsidian| OB["ObsidianMemoryProvider\ncopy to vault"]
        MP -->|backend=agentsynapse| AS["AgentSynapseProvider\nHTTP POST to localhost:8000"]
    end

    subgraph SKILLS["Skill persistence"]
        CST["Agent calls create_skill tool\n(CreateSkillTool)"]
        SS["SkillStore.save(skill)\natomic tmp→rename"]
        DISK["~/.swarm/skills/{name}.json"]
        LOAD["SkillStore.load()\nApp startup"]
        MENU["dynamicSkills state\n→ SlashMenu + /skills command"]

        CST --> SS
        SS --> DISK
        DISK -->|next session| LOAD
        LOAD --> MENU
    end
```

---

## 6. MCP Integration

How external tools from Model Context Protocol servers are discovered and called.

```mermaid
sequenceDiagram
    participant CFG as config.toml\n[[mcp.servers]]
    participant MM as McpManager
    participant MC as McpClient
    participant CP as child process\n(stdio)
    participant A as Agent

    Note over CFG,CP: Startup — connect phase
    CFG->>MM: connectAll(servers)
    MM->>MC: new McpClient(cfg)
    MC->>CP: spawn command + args
    CP-->>MC: stdio JSON-RPC initialize →
    MC->>CP: tools/list request
    CP-->>MC: tools list response
    MC->>MC: store tool descriptors

    MM->>A: getTools() → McpAgentTool[]\ninjected into agent's tool list

    Note over A,CP: Runtime — tool call
    A->>MC: McpAgentTool.call(input)
    MC->>CP: JSON-RPC tools/call {name, arguments}
    CP-->>MC: result content
    MC-->>A: formatted result string
```

---

## 7. Full System Component Map

```mermaid
graph TB
    subgraph TUI["TUI Layer (@swarm/tui)"]
        FL["FullscreenLayout"]
        ML["MessageList"]
        PI["PromptInput"]
        SL["StatusLine"]
        AP["AgentPanel"]
        CL["CommLog"]
        MPK["ModelPicker"]
        SM["SlashMenu"]
    end

    subgraph APP["App Layer (apps/cli)"]
        IDX["index.tsx\nstartup + wiring"]
        APPTSX["App.tsx\nstate orchestrator"]
    end

    subgraph AGENT["Agent Layer"]
        AG["Agent\n(id, bus, registry)"]
        QE["QueryEngine\n(turn loop)"]
        CO["Coordinator\n(task scheduler)"]
        WP["WorkerPool\n(worker agents)"]
    end

    subgraph BUS["Bus Layer (@swarm/bus)"]
        MB["MessageBus\n(pub/sub + inbox)"]
        AR["AgentRegistry\n(presence tracking)"]
    end

    subgraph TOOLS["Tool Layer"]
        BT["BashTool"]
        FT["FileRead/Write/Edit/Glob/Grep"]
        SAT["SendAgentMessageTool"]
        SWT["SwarmAgentTool (spawn_agent)"]
        SPT["SwarmAddTaskTool + SwarmRunTool"]
        MAT["McpAgentTool"]
        CST["CreateSkillTool"]
    end

    subgraph PROV["Provider Layer (@swarm/providers)"]
        ANT["AnthropicProvider"]
        OLL["OllamaProvider"]
        OPR["OpenRouterProvider"]
        REP["ReplicateProvider"]
    end

    subgraph PERSIST["Persistence (~/.swarm/)"]
        CFG2["config.toml"]
        INBOX["inbox/{agentId}/*.json"]
        REG["agents/registry.json"]
        SKILLS["skills/*.json"]
        HAND["handoff/HANDOFF.md + MEMORY.md"]
        LOGS["logs/swarm.log"]
    end

    subgraph HUB["Hub Layer (@swarm/hub)"]
        HS["HubServer\n(memory API, OTLP,\nagent registry API,\nsession history)"]
        MEMP["MemoryProvider\n(markdown/obsidian/agentsynapse)"]
        SKS["SkillStore"]
    end

    subgraph MCP["MCP Layer (@swarm/mcp)"]
        MGR["McpManager"]
        MCL["McpClient(s)"]
        CHILD["child processes\n(stdio JSON-RPC)"]
    end

    IDX --> APPTSX
    IDX --> AG
    IDX --> MB
    IDX --> AR
    IDX --> MGR

    APPTSX --> FL
    FL --> ML & PI & SL & AP & CL & MPK & SM

    APPTSX --> AG
    APPTSX --> CO
    AG --> QE
    QE --> ANT & OLL & OPR & REP
    CO --> WP
    WP --> AG

    AG --> MB
    AG --> AR
    MB --> INBOX
    AR --> REG

    AG --> BT & FT & SAT & SWT & SPT & MAT & CST

    MGR --> MCL --> CHILD

    APPTSX --> MEMP
    MEMP --> HAND
    SKS --> SKILLS

    HS --> LOGS
```
