import React from 'react'
import { Box } from 'ink'
import { useTerminalSize } from './useTerminalSize.js'
import { MessageList } from './MessageList.js'
import { PromptInput } from './PromptInput.js'
import { StatusLine } from './StatusLine.js'
import { ModelPicker } from './ModelPicker.js'
import { AgentPanel } from './AgentPanel.js'
import type { ChatMessage } from './types.js'
import type { AgentWorkerStatus, TaskSummary } from './AgentPanel.js'
import type { SlashCommand } from './commands.js'

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
  // Picker overlay
  showPicker?: boolean
  pickerProviders?: Array<{ id: string; name: string; models: string[] }>
  onPickerSelect?: (provider: string, model: string) => void
  onPickerCancel?: () => void
  // Swarm agent panel
  workers?: AgentWorkerStatus[]
  taskSummary?: TaskSummary
  showAgentPanel?: boolean
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
  showPicker = false,
  pickerProviders,
  onPickerSelect,
  onPickerCancel,
  workers = [],
  taskSummary,
  showAgentPanel = false,
}: FullscreenLayoutProps): React.JSX.Element {
  const { rows } = useTerminalSize()

  const agentPanelVisible = showAgentPanel && workers.length > 0
  const agentPanelHeight = agentPanelVisible ? workers.length + 2 : 0 // workers + top border + bottom border
  const messageListHeight = Math.max(1, rows - PROMPT_HEIGHT - STATUS_HEIGHT - agentPanelHeight)

  return (
    <Box flexDirection="column" height={rows}>
      {agentPanelVisible && (
        <AgentPanel workers={workers} taskSummary={taskSummary} isVisible={true} />
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
      />
    </Box>
  )
}
