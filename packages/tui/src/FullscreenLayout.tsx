import React from 'react'
import { Box } from 'ink'
import { useTerminalSize } from './useTerminalSize.js'
import { MessageList } from './MessageList.js'
import { PromptInput } from './PromptInput.js'
import { StatusLine } from './StatusLine.js'
import { ModelPicker } from './ModelPicker.js'
import { AgentPanel } from './AgentPanel.js'
import { CommLog } from './CommLog.js'
import type { ChatMessage } from './types.js'
import type { AgentWorkerStatus, TaskSummary } from './AgentPanel.js'
import type { SlashCommand, ActionCommand } from './commands.js'
import type { AgentMessage, CommunicationMode } from '@swarm/bus'

export interface FullscreenLayoutProps {
  messages: ChatMessage[]
  onSubmit: (value: string) => void
  appName?: string
  model: string
  provider: string
  agentCount?: number
  cost?: number
  isStreaming?: boolean
  disabled?: boolean
  contextPct?: number
  trainingWheels?: boolean
  onCommand?: (command: SlashCommand) => void
  extraCommands?: ActionCommand[]
  // Picker overlay
  showPicker?: boolean
  pickerProviders?: Array<{ id: string; name: string; models: string[] }>
  onPickerSelect?: (provider: string, model: string) => void
  onPickerCancel?: () => void
  // Swarm agent panel
  workers?: AgentWorkerStatus[]
  taskSummary?: TaskSummary
  showAgentPanel?: boolean
  // Inter-agent comm log
  commLog?: AgentMessage[]
  showCommLog?: boolean
  commMode?: CommunicationMode
}

// Approximate fixed-height rows consumed by PromptInput (border + content) and StatusLine
const PROMPT_HEIGHT = 3
const STATUS_HEIGHT = 1

export function FullscreenLayout({
  messages,
  onSubmit,
  appName,
  model,
  provider,
  agentCount = 1,
  cost,
  isStreaming = false,
  disabled = false,
  contextPct,
  trainingWheels = false,
  onCommand,
  extraCommands = [],
  showPicker = false,
  pickerProviders,
  onPickerSelect,
  onPickerCancel,
  workers = [],
  taskSummary,
  showAgentPanel = false,
  commLog = [],
  showCommLog = false,
  commMode,
}: FullscreenLayoutProps): React.JSX.Element {
  const { rows } = useTerminalSize()

  const agentPanelVisible = showAgentPanel && workers.length > 0
  const agentPanelHeight = agentPanelVisible ? workers.length + 2 : 0
  const commLogVisible = showCommLog && commLog.length > 0
  const commLogRows = Math.min(commLog.length, 8)
  const commLogHeight = commLogVisible ? commLogRows + 2 : 0
  const messageListHeight = Math.max(
    1,
    rows - PROMPT_HEIGHT - STATUS_HEIGHT - agentPanelHeight - commLogHeight,
  )

  return (
    <Box flexDirection="column" height={rows}>
      {agentPanelVisible && (
        <AgentPanel workers={workers} taskSummary={taskSummary} isVisible={true} />
      )}
      {commLogVisible && (
        <CommLog messages={commLog} isVisible={true} maxRows={commLogRows} />
      )}
      <Box flexDirection="column" flexGrow={1}>
        {showPicker && pickerProviders && onPickerSelect && onPickerCancel ? (
          <Box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
            <ModelPicker
              providers={pickerProviders}
              currentProvider={provider}
              currentModel={model}
              onSelect={onPickerSelect}
              onCancel={onPickerCancel}
            />
          </Box>
        ) : (
          <MessageList messages={messages} maxHeight={messageListHeight} />
        )}
      </Box>
      <PromptInput
        onSubmit={onSubmit}
        onCommand={onCommand}
        disabled={disabled || showPicker}
        placeholder="Type a message..."
        extraCommands={extraCommands}
      />
      <StatusLine
        appName={appName}
        model={model}
        provider={provider}
        agentCount={agentCount}
        cost={cost}
        isStreaming={isStreaming}
        contextPct={contextPct}
        trainingWheels={trainingWheels}
        commMode={commMode}
      />
    </Box>
  )
}
