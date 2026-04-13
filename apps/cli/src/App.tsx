import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useInput, type Key } from 'ink'
import { ThemeProvider, FullscreenLayout } from '@swarm/tui'
import type { ChatMessage, MessageContent, AgentWorkerStatus, TaskSummary } from '@swarm/tui'
import type { Agent, AgentTool } from '@swarm/orchestrator'
import { Coordinator } from '@swarm/orchestrator'
import type { CoordinatorEvent } from '@swarm/orchestrator'
import type { SlashCommand } from '@swarm/tui'
import { getContextWindow } from '@swarm/providers'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { messageGrantsWriteApproval } from './trainingWheels.js'

interface AppProps {
  agent: Agent
  workingDir: string
  adaptedTools: AgentTool[]
  trainingWheels?: boolean
  writePassState?: { approved: boolean }
}

let _idCounter = 0
function nextId(): string {
  return `msg-${++_idCounter}`
}

const HANDOFF_THRESHOLD = 85

function buildHandoffPrompt(pct: number): string {
  return (
    `[SYSTEM] Context window is at ${pct}% capacity. ` +
    `Before this session ends, write a Handoff Transcript and Memory file so the next session can continue seamlessly.\n\n` +
    `Use the file_write tool to create both files:\n\n` +
    `1. ~/.swarm/handoff/HANDOFF.md — Handoff Transcript:\n` +
    `   - Summary of the current task and conversation\n` +
    `   - Key decisions made and why\n` +
    `   - Current state: what was accomplished, what's in progress\n` +
    `   - What needs to happen next (concrete next steps)\n` +
    `   - Any blockers or open questions\n\n` +
    `2. ~/.swarm/handoff/MEMORY.md — Memory Dump:\n` +
    `   - Project context and goals\n` +
    `   - Important files and their roles\n` +
    `   - Architecture decisions and constraints\n` +
    `   - Known issues or quirks\n` +
    `   - Anything a new session needs to pick up exactly where we left off\n\n` +
    `Write the files now.`
  )
}

export function App({ agent, workingDir, adaptedTools, trainingWheels = false, writePassState }: AppProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [cost] = useState<number>(0)
  const [contextTokens, setContextTokens] = useState(0)
  const [workers, setWorkers] = useState<AgentWorkerStatus[]>([])
  const [taskSummary, setTaskSummary] = useState<TaskSummary | undefined>(undefined)
  const [showAgentPanel, setShowAgentPanel] = useState(false)
  const [coordinator, setCoordinator] = useState<Coordinator | undefined>(undefined)

  // Track the current assistant message id across streaming events
  const assistantMsgIdRef = useRef<string | null>(null)
  // Prevent firing handoff more than once per session
  const handoffTriggeredRef = useRef(false)

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

  // Trigger handoff when context hits the threshold
  useEffect(() => {
    if (
      contextPct === undefined ||
      contextPct < HANDOFF_THRESHOLD ||
      handoffTriggeredRef.current ||
      isStreaming
    ) return

    handoffTriggeredRef.current = true

    const pct = contextPct
    ;(async () => {
      // Ensure handoff directory exists
      const handoffDir = join(homedir(), '.swarm', 'handoff')
      await mkdir(handoffDir, { recursive: true })

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
        for await (const event of agent.run(buildHandoffPrompt(pct))) {
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
          }
        }
      } catch {
        setIsStreaming(false)
        assistantMsgIdRef.current = null
      }
    })()
  }, [contextPct, isStreaming, agent])

  // Ctrl+W toggles the AgentPanel
  useInput((input: string, key: Key) => {
    if (key.ctrl && input.toLowerCase() === 'w') {
      setShowAgentPanel(prev => !prev)
    }
  })

  const onSubmit = useCallback(
    (text: string) => {
      if (isStreaming) return

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

      // Run the agent loop in the background
      ;(async () => {
        try {
          for await (const event of agent.run(text)) {
            if (event.type === 'text') {
              setMessages(prev => {
                const existingId = assistantMsgIdRef.current
                if (existingId) {
                  // Append delta to existing assistant text block
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
                  // Create a new assistant message
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
                  // Append to existing thinking block or add one
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
              // Next text event should go into a new assistant message
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
    },
    [agent, isStreaming],
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

      case 'config':
        setMessages(prev => [...prev, systemMsg(
          `Config\n` +
          `  Working dir : ${workingDir}\n` +
          `  Config file : ~/.swarm/config.toml\n` +
          `  Model       : ${agent.model}\n` +
          `  Provider    : ${agent.providerId}`
        )])
        break

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
          `  /training-wheels  Training wheels status\n` +
          `\n` +
          `Keybindings\n` +
          `  Ctrl+W   Toggle agent panel\n` +
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
        // TODO: wire up model picker overlay
        setMessages(prev => [...prev, systemMsg(`Model picker coming soon — use -m flag for now.`)])
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

      case 'training-wheels':
        setMessages(prev => [...prev, systemMsg(
          trainingWheels
            ? `Training wheels: ON\n  Bash is disabled. All file access restricted to ${workingDir}.\n  Writes require your approval.`
            : `Training wheels: OFF\n  Start with --training-wheels to enable.`
        )])
        break
    }
  }, [agent, workingDir, contextPct, contextWindow, trainingWheels])

  return (
    <ThemeProvider>
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
      />
    </ThemeProvider>
  )
}
