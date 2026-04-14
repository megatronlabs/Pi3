import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useInput, type Key } from 'ink'
import { ThemeProvider, FullscreenLayout, getTheme, THEMES, darkTheme } from '@swarm/tui'
import type { ChatMessage, MessageContent, AgentWorkerStatus, TaskSummary, Theme } from '@swarm/tui'
import type { Agent, AgentTool, WorkerPool } from '@swarm/orchestrator'
import { Coordinator, SwarmAddTaskTool, SwarmRunTool, TaskGraph } from '@swarm/orchestrator'
import type { CoordinatorEvent } from '@swarm/orchestrator'
import type { SlashCommand } from '@swarm/tui'
import { getContextWindow } from '@swarm/providers'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { messageGrantsWriteApproval } from './trainingWheels.js'
import type { RoleAssignment } from '@swarm/config'
import { ROLE_NAMES, listPresets, BUILT_IN_PRESETS } from '@swarm/config'
import type { RoleName } from '@swarm/config'
import type { MessageBus, AgentMessage, CommunicationMode } from '@swarm/bus'
import type { MemoryProvider, HandoffFiles } from '@swarm/hub'

interface AppProps {
  agent: Agent
  workingDir: string
  adaptedTools: AgentTool[]
  trainingWheels?: boolean
  writePassState?: { approved: boolean }
  activePreset?: string
  allRoles?: Record<RoleName, RoleAssignment>
  bus?: MessageBus
  commMode?: CommunicationMode
  memoryProvider?: MemoryProvider
  contextThreshold?: number
  handoffDir?: string
  sessionId?: string
  theme?: Theme
  providers?: Array<{ id: string; name: string; models: string[] }>
  onModelSwap?: (provider: string, model: string) => void
  swarmMode?: boolean
  workerFactory?: (count: number) => WorkerPool
}

let _idCounter = 0
function nextId(): string {
  return `msg-${++_idCounter}`
}

function buildHandoffPrompt(pct: number, handoffDir: string): string {
  return (
    `[SYSTEM] Context window is at ${pct}% capacity. ` +
    `Before this session ends, write a Handoff Transcript and Memory file so the next session can continue seamlessly.\n\n` +
    `Use the file_write tool to create both files:\n\n` +
    `1. ${handoffDir}/HANDOFF.md — Handoff Transcript:\n` +
    `   - Summary of the current task and conversation\n` +
    `   - Key decisions made and why\n` +
    `   - Current state: what was accomplished, what's in progress\n` +
    `   - What needs to happen next (concrete next steps)\n` +
    `   - Any blockers or open questions\n\n` +
    `2. ${handoffDir}/MEMORY.md — Memory Dump:\n` +
    `   - Project context and goals\n` +
    `   - Important files and their roles\n` +
    `   - Architecture decisions and constraints\n` +
    `   - Known issues or quirks\n` +
    `   - Anything a new session needs to pick up exactly where we left off\n\n` +
    `Write the files now.`
  )
}

export function App({ agent, workingDir, adaptedTools, trainingWheels = false, writePassState, activePreset = 'default', allRoles, bus, commMode, memoryProvider, contextThreshold = 85, handoffDir, sessionId, theme, providers, onModelSwap, swarmMode = false, workerFactory }: AppProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [activeTheme, setActiveTheme] = useState<Theme>(theme ?? darkTheme)
  const [isStreaming, setIsStreaming] = useState(false)
  const [cost] = useState<number>(0)
  const [contextTokens, setContextTokens] = useState(0)
  const [workers, setWorkers] = useState<AgentWorkerStatus[]>([])
  const [taskSummary, setTaskSummary] = useState<TaskSummary | undefined>(undefined)
  const [showAgentPanel, setShowAgentPanel] = useState(false)
  const [coordinator, setCoordinator] = useState<Coordinator | undefined>(undefined)
  const [commLog, setCommLog] = useState<AgentMessage[]>([])
  const [showCommLog, setShowCommLog] = useState(false)
  const [showModelPicker, setShowModelPicker] = useState(false)

  // Track the current assistant message id across streaming events
  const assistantMsgIdRef = useRef<string | null>(null)
  // Prevent firing handoff more than once per session
  const handoffTriggeredRef = useRef(false)
  // Pending task graph for swarm planning turns
  const pendingGraphRef = useRef<TaskGraph | null>(null)

  const contextWindow = getContextWindow(agent.model)
  const contextPct = contextTokens > 0
    ? Math.min(100, Math.round((contextTokens / contextWindow) * 100))
    : undefined

  // coordinator and adaptedTools/workingDir are available for future swarm wiring;
  // SwarmAgentTool is constructed in index.tsx before the Agent is created.

  // Wire coordinator events whenever a coordinator is set
  useEffect(() => {
    if (!coordinator) return

    const handler = (evt: CoordinatorEvent) => {
      if (
        evt.type === 'task_assigned' ||
        evt.type === 'task_complete' ||
        evt.type === 'task_error'
      ) {
        const state = coordinator.getState()
        const mappedWorkers: AgentWorkerStatus[] = state.workers.map(w => ({
          id: w.id,
          name: w.name,
          model: w.model,
          provider: w.providerId,
          busy: w.busy,
          currentTaskId: w.currentTaskId,
          status: w.busy ? 'running' : (w.agentStatus === 'error' ? 'error' : 'idle'),
          messageCount: 0,
        }))
        setWorkers(mappedWorkers)
        setTaskSummary(state.summary as TaskSummary)
      }
      if (evt.type === 'swarm_complete') {
        setWorkers([])
      }
    }

    coordinator.on('coordinator_event', handler)
    return () => {
      coordinator.off('coordinator_event', handler)
    }
  }, [coordinator])

  // Subscribe to bus messages for CommLog
  useEffect(() => {
    if (!bus) return
    const unsub = bus.monitor(msg => {
      setCommLog(prev => [...prev.slice(-499), msg])
    })
    return unsub
  }, [bus])

  // Trigger handoff when context hits the threshold
  useEffect(() => {
    if (
      contextPct === undefined ||
      contextPct < contextThreshold ||
      handoffTriggeredRef.current ||
      isStreaming
    ) return

    handoffTriggeredRef.current = true

    const pct = contextPct
    const resolvedHandoffDir = handoffDir ?? join(homedir(), '.swarm', 'handoff')
    ;(async () => {
      // Ensure handoff directory exists
      await mkdir(resolvedHandoffDir, { recursive: true })

      // Show a system notice in the chat
      const noticeId = nextId()
      const notice: ChatMessage = {
        id: noticeId,
        role: 'assistant',
        content: [{
          kind: 'text',
          text: `⚠ Context at ${pct}% — composing Handoff Transcript and Memory file...`,
        }],
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, notice])
      setIsStreaming(true)
      assistantMsgIdRef.current = null

      try {
        for await (const event of agent.run(buildHandoffPrompt(pct, resolvedHandoffDir))) {
          if (event.type === 'text') {
            setMessages(prev => {
              const existingId = assistantMsgIdRef.current
              if (existingId) {
                return prev.map(msg => {
                  if (msg.id !== existingId) return msg
                  return {
                    ...msg,
                    content: msg.content.map(b =>
                      b.kind === 'text' ? { ...b, text: b.text + event.delta } as MessageContent : b
                    ),
                  }
                })
              }
              const newId = nextId()
              assistantMsgIdRef.current = newId
              return [...prev, {
                id: newId,
                role: 'assistant' as const,
                content: [{ kind: 'text', text: event.delta }],
                timestamp: new Date(),
              }]
            })
          } else if (event.type === 'tool_start') {
            const toolMsgId = nextId()
            setMessages(prev => [...prev, {
              id: toolMsgId,
              role: 'assistant',
              content: [{
                kind: 'tool_use',
                id: event.toolCallId,
                name: event.toolName,
                input: event.toolInput,
                status: 'running',
              } as MessageContent],
              timestamp: new Date(),
            }])
            assistantMsgIdRef.current = null
          } else if (event.type === 'tool_done') {
            setMessages(prev => prev.map(msg => {
              const hasBlock = msg.content.some(b => b.kind === 'tool_use' && b.id === event.toolCallId)
              if (!hasBlock) return msg
              return {
                ...msg,
                content: msg.content.map(b =>
                  b.kind === 'tool_use' && b.id === event.toolCallId
                    ? { ...b, status: event.toolError ? 'error' : 'done' } as MessageContent
                    : b
                ),
              }
            }))
          } else if (event.type === 'done' || event.type === 'error') {
            setIsStreaming(false)
            assistantMsgIdRef.current = null

            // Notify the memory provider that files have been written
            if (event.type === 'done' && memoryProvider) {
              const files: HandoffFiles = {
                transcriptPath: join(resolvedHandoffDir, 'HANDOFF.md'),
                memoryPath:     join(resolvedHandoffDir, 'MEMORY.md'),
                timestamp:      new Date(),
                sessionId:      sessionId ?? agent.sessionId,
                contextPct:     pct,
              }
              memoryProvider.onHandoffComplete(files).catch(() => {
                // Never crash the app for memory sync failures
              })
            }
          }
        }
      } catch {
        setIsStreaming(false)
        assistantMsgIdRef.current = null
      }
    })()
  }, [contextPct, contextThreshold, isStreaming, agent, memoryProvider, handoffDir, sessionId])

  // Ctrl+W toggles AgentPanel · Ctrl+L toggles CommLog · Ctrl+M toggles ModelPicker
  useInput((input: string, key: Key) => {
    if (key.ctrl && input.toLowerCase() === 'w') {
      setShowAgentPanel(prev => !prev)
    }
    if (key.ctrl && input.toLowerCase() === 'l') {
      setShowCommLog(prev => !prev)
    }
    if (key.ctrl && input.toLowerCase() === 'm') {
      setShowModelPicker(prev => !prev)
    }
  })

  // ── Streaming helper ────────────────────────────────────────────────────────
  // Drains a TurnEvent async iterable into the messages state.
  // Returns a promise that resolves when the turn is done or errors.
  async function drainAgentRun(iterable: AsyncIterable<import('@swarm/orchestrator').TurnEvent>): Promise<void> {
    for await (const event of iterable) {
      if (event.type === 'text') {
        setMessages(prev => {
          const existingId = assistantMsgIdRef.current
          if (existingId) {
            return prev.map(msg => {
              if (msg.id !== existingId) return msg
              const newContent = msg.content.map(block => {
                if (block.kind === 'text') {
                  return { ...block, text: block.text + event.delta } as MessageContent
                }
                return block
              })
              return { ...msg, content: newContent }
            })
          } else {
            const newId = nextId()
            assistantMsgIdRef.current = newId
            const newMsg: ChatMessage = {
              id: newId,
              role: 'assistant',
              content: [{ kind: 'text', text: event.delta }],
              timestamp: new Date(),
            }
            return [...prev, newMsg]
          }
        })
      } else if (event.type === 'thinking') {
        setMessages(prev => {
          const existingId = assistantMsgIdRef.current
          if (existingId) {
            return prev.map(msg => {
              if (msg.id !== existingId) return msg
              const thinkingBlock = msg.content.find(b => b.kind === 'thinking')
              if (thinkingBlock) {
                return {
                  ...msg,
                  content: msg.content.map(b =>
                    b.kind === 'thinking'
                      ? ({ ...b, text: b.text + event.delta } as MessageContent)
                      : b,
                  ),
                }
              }
              return {
                ...msg,
                content: [...msg.content, { kind: 'thinking', text: event.delta } as MessageContent],
              }
            })
          } else {
            const newId = nextId()
            assistantMsgIdRef.current = newId
            const newMsg: ChatMessage = {
              id: newId,
              role: 'assistant',
              content: [{ kind: 'thinking', text: event.delta }],
              timestamp: new Date(),
            }
            return [...prev, newMsg]
          }
        })
      } else if (event.type === 'tool_start') {
        const toolMsgId = nextId()
        const toolMsg: ChatMessage = {
          id: toolMsgId,
          role: 'assistant',
          content: [
            {
              kind: 'tool_use',
              id: event.toolCallId,
              name: event.toolName,
              input: event.toolInput,
              status: 'running',
            } as MessageContent,
          ],
          timestamp: new Date(),
        }
        setMessages(prev => [...prev, toolMsg])
        assistantMsgIdRef.current = null
      } else if (event.type === 'tool_done') {
        setMessages(prev =>
          prev.map(msg => {
            const hasBlock = msg.content.some(
              b => b.kind === 'tool_use' && b.id === event.toolCallId,
            )
            if (!hasBlock) return msg
            return {
              ...msg,
              content: msg.content.map(b => {
                if (b.kind === 'tool_use' && b.id === event.toolCallId) {
                  return {
                    ...b,
                    status: event.toolError ? 'error' : 'done',
                  } as MessageContent
                }
                return b
              }),
            }
          }),
        )
      } else if (event.type === 'usage') {
        setContextTokens(event.inputTokens)
      } else if (event.type === 'done') {
        setIsStreaming(false)
        assistantMsgIdRef.current = null
      } else if (event.type === 'error') {
        const errorMsg: ChatMessage = {
          id: nextId(),
          role: 'assistant',
          content: [{ kind: 'error', message: event.message }],
          timestamp: new Date(),
        }
        setMessages(prev => [...prev, errorMsg])
        setIsStreaming(false)
        assistantMsgIdRef.current = null
      }
    }
  }

  const onSubmit = useCallback(
    (text: string) => {
      if (isStreaming) return

      // Handle /theme <name> typed with argument (e.g. "/theme catppuccin")
      if (text.startsWith('/theme ')) {
        const name = text.slice(7).trim()
        const resolved = getTheme(name)
        const known = Object.keys(THEMES)
        if (!known.includes(name)) {
          setMessages(prev => [...prev, {
            id: nextId(), role: 'assistant',
            content: [{ kind: 'text', text: `Unknown theme "${name}". Available: ${known.join(', ')}` }],
            timestamp: new Date(),
          }])
        } else {
          setActiveTheme(resolved)
          setMessages(prev => [...prev, {
            id: nextId(), role: 'assistant',
            content: [{ kind: 'text', text: `Theme switched to "${name}".` }],
            timestamp: new Date(),
          }])
        }
        return
      }

      // Training wheels: detect write approval in user message
      if (trainingWheels && writePassState && messageGrantsWriteApproval(text)) {
        writePassState.approved = true
      }

      // Add the user message immediately
      const userMsg: ChatMessage = {
        id: nextId(),
        role: 'user',
        content: [{ kind: 'text', text }],
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, userMsg])
      setIsStreaming(true)
      assistantMsgIdRef.current = null

      if (swarmMode && workerFactory) {
        // ── Swarm planning path ──────────────────────────────────────────────
        ;(async () => {
          const graph = new TaskGraph()
          pendingGraphRef.current = graph

          const addTaskTool = new SwarmAddTaskTool(graph)
          const runTool = new SwarmRunTool(() => {
            const g = pendingGraphRef.current
            if (!g) return
            const count = g.getAllTasks().length
            if (count === 0) return
            const pool = workerFactory(count)
            const coord = new Coordinator(g, pool)
            setCoordinator(coord)
            const workerCount = Math.min(count, 4)
            setMessages(prev => [...prev, {
              id: nextId(),
              role: 'assistant',
              content: [{ kind: 'text', text: `Swarm running: ${count} task${count !== 1 ? 's' : ''} across ${workerCount} worker${workerCount !== 1 ? 's' : ''}` }],
              timestamp: new Date(),
            }])
            coord.run().catch(err => {
              const message = err instanceof Error ? err.message : String(err)
              setMessages(prev => [...prev, {
                id: nextId(),
                role: 'assistant',
                content: [{ kind: 'error', message }],
                timestamp: new Date(),
              }])
            })
          })

          const removeTools = agent.appendTools([addTaskTool, runTool])
          try {
            await drainAgentRun(agent.run(text))
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            setMessages(prev => [...prev, {
              id: nextId(),
              role: 'assistant',
              content: [{ kind: 'error', message }],
              timestamp: new Date(),
            }])
            setIsStreaming(false)
            assistantMsgIdRef.current = null
          } finally {
            removeTools()
          }
        })()
      } else {
        // ── Normal path ──────────────────────────────────────────────────────
        ;(async () => {
          try {
            await drainAgentRun(agent.run(text))
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            const errorMsg: ChatMessage = {
              id: nextId(),
              role: 'assistant',
              content: [{ kind: 'error', message }],
              timestamp: new Date(),
            }
            setMessages(prev => [...prev, errorMsg])
            setIsStreaming(false)
            assistantMsgIdRef.current = null
          }
        })()
      }
    },
    [agent, isStreaming, swarmMode, workerFactory],
  )

  const onCommand = useCallback((command: SlashCommand) => {
    const systemMsg = (text: string): ChatMessage => ({
      id: nextId(),
      role: 'assistant',
      content: [{ kind: 'text', text }],
      timestamp: new Date(),
    })

    switch (command.name) {
      case 'clear':
        agent.reset()
        setMessages([])
        setContextTokens(0)
        handoffTriggeredRef.current = false
        break

      case 'compact': {
        agent.compact()
        const kept = agent.getHistory().length
        setMessages(prev => [...prev, systemMsg(`History compacted — keeping last ${kept} messages.`)])
        break
      }

      case 'config': {
        const roleLines = allRoles
          ? ROLE_NAMES.map(r => `  ${r.padEnd(14)}: ${allRoles[r].model} (${allRoles[r].provider})`).join('\n')
          : '  (no role config)'
        setMessages(prev => [...prev, systemMsg(
          `Config\n` +
          `  Working dir : ${workingDir}\n` +
          `  Config file : ~/.swarm/config.toml\n` +
          `  Preset      : ${activePreset}\n` +
          `  Model       : ${agent.model}\n` +
          `  Provider    : ${agent.providerId}\n` +
          `\nRole Assignments\n${roleLines}`
        )])
        break
      }

      case 'preset': {
        const available = ['default', 'quality', 'fast', 'local', 'mixed']
        const roleLines = allRoles
          ? ROLE_NAMES.map(r => `  ${r.padEnd(14)}: ${allRoles[r].model} (${allRoles[r].provider})`).join('\n')
          : ''
        setMessages(prev => [...prev, systemMsg(
          `Active preset: ${activePreset}\n\nRole assignments:\n${roleLines}\n\n` +
          `Available presets: ${available.join(', ')}\n` +
          `Switch with --preset <name> at startup.`
        )])
        break
      }

      case 'exit':
        process.exit(0)
        break

      case 'help':
        setMessages(prev => [...prev, systemMsg(
          `Commands\n` +
          `  /clear            Clear chat history\n` +
          `  /compact          Compact history to save context\n` +
          `  /config           Show config and working directory\n` +
          `  /exit             Exit Pi3\n` +
          `  /mcp              MCP server status\n` +
          `  /model            Switch provider / model\n` +
          `  /status           Session status\n` +
          `  /theme            Switch UI theme\n` +
          `  /training-wheels  Training wheels status\n` +
          `\n` +
          `Keybindings\n` +
          `  Ctrl+W   Toggle agent panel\n` +
          `  Ctrl+L   Toggle comm log\n` +
          `  Ctrl+M   Toggle model picker\n` +
          `  Ctrl+C   Exit`
        )])
        break

      case 'mcp':
        setMessages(prev => [...prev, systemMsg(
          `MCP (Model Context Protocol)\n` +
          `  Status: not connected\n` +
          `  MCP server integration is planned for Phase 4.`
        )])
        break

      case 'model':
        setShowModelPicker(true)
        break

      case 'status': {
        const history = agent.getHistory()
        const pctStr = contextPct !== undefined ? `${contextPct}%` : 'unknown'
        setMessages(prev => [...prev, systemMsg(
          `Session Status\n` +
          `  Model     : ${agent.model} (${agent.providerId})\n` +
          `  Context   : ${pctStr} of ${contextWindow.toLocaleString()} tokens\n` +
          `  History   : ${history.length} messages\n` +
          `  Status    : ${agent.status}`
        )])
        break
      }

      case 'theme': {
        const available = Object.keys(THEMES)
        const current = available.find(k => THEMES[k] === activeTheme) ?? 'custom'
        setMessages(prev => [...prev, systemMsg(
          `Theme\n` +
          `  Current : ${current}\n` +
          `  Available: ${available.join(', ')}\n\n` +
          `Switch with /theme <name>  (e.g. /theme catppuccin)`
        )])
        break
      }

      case 'training-wheels':
        setMessages(prev => [...prev, systemMsg(
          trainingWheels
            ? `Training wheels: ON\n  Bash is disabled. All file access restricted to ${workingDir}.\n  Writes require your approval.`
            : `Training wheels: OFF\n  Start with --training-wheels to enable.`
        )])
        break
    }
  }, [agent, workingDir, contextPct, contextWindow, trainingWheels, activeTheme])

  function handlePickerSelect(providerId: string, model: string): void {
    setShowModelPicker(false)
    onModelSwap?.(providerId, model)
    setMessages(prev => [...prev, {
      id: nextId(),
      role: 'assistant',
      content: [{ kind: 'text', text: `Switched to ${model} (${providerId})` }],
      timestamp: new Date(),
    }])
  }

  return (
    <ThemeProvider theme={activeTheme}>
      <FullscreenLayout
        messages={messages}
        onSubmit={onSubmit}
        onCommand={onCommand}
        appName="Pi3"
        model={agent.model}
        provider={agent.providerId}
        agentCount={1}
        cost={cost}
        isStreaming={isStreaming}
        disabled={isStreaming}
        contextPct={contextPct}
        trainingWheels={trainingWheels}
        workers={workers}
        taskSummary={taskSummary}
        showAgentPanel={showAgentPanel && workers.length > 0}
        commLog={commLog}
        showCommLog={showCommLog && commLog.length > 0}
        commMode={commMode}
        showPicker={showModelPicker}
        pickerProviders={providers}
        onPickerSelect={handlePickerSelect}
        onPickerCancel={() => setShowModelPicker(false)}
      />
    </ThemeProvider>
  )
}
