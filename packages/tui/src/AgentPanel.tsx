import React from 'react'
import { Box, Text } from 'ink'
import figures from 'figures'
import { useTheme } from './theme.js'
import { useSpinner } from './useSpinner.js'

export interface AgentWorkerStatus {
  id: string
  name: string
  model: string
  provider: string
  busy: boolean
  currentTaskId?: string
  currentTaskTitle?: string
  status: 'idle' | 'running' | 'done' | 'error'
  messageCount: number
}

export interface TaskSummary {
  total: number
  pending: number
  running: number
  done: number
  error: number
}

export interface AgentPanelProps {
  workers: AgentWorkerStatus[]
  taskSummary?: TaskSummary
  isVisible: boolean
}

const MAX_TASK_ID_LENGTH = 12

function truncate(str: string, max: number): string {
  if (str.length <= max) return str
  return str.slice(0, max - 1) + '…'
}

function WorkerRow({ worker }: { worker: AgentWorkerStatus }): React.JSX.Element {
  const theme = useTheme()
  const spinner = useSpinner(80)

  let icon: string
  let iconColor: string

  if (worker.status === 'error') {
    icon = figures.cross
    iconColor = theme.error
  } else if (worker.busy || worker.status === 'running') {
    icon = spinner
    iconColor = theme.tool
  } else {
    icon = figures.tick
    iconColor = theme.success
  }

  let statusColor: string
  if (worker.status === 'error') {
    statusColor = theme.error
  } else if (worker.status === 'running') {
    statusColor = theme.tool
  } else {
    statusColor = theme.success
  }

  const taskPart =
    worker.currentTaskId != null
      ? `[${truncate(worker.currentTaskId, MAX_TASK_ID_LENGTH)}] ${worker.status}`
      : worker.status

  return (
    <Box flexDirection="row" paddingX={1}>
      <Text color={iconColor}>{icon}</Text>
      <Text>{' '}</Text>
      <Text color={theme.primary}>{worker.name.padEnd(12)}</Text>
      <Text>{' '}</Text>
      <Text color={theme.secondary}>{worker.model.padEnd(18)}</Text>
      <Text>{' '}</Text>
      <Text color={theme.secondary}>{worker.provider.padEnd(14)}</Text>
      <Text color={statusColor}>{taskPart}</Text>
    </Box>
  )
}

export function AgentPanel({
  workers,
  taskSummary,
  isVisible,
}: AgentPanelProps): React.JSX.Element | null {
  const theme = useTheme()

  if (!isVisible || workers.length === 0) {
    return null
  }

  let headerRight = ''
  if (taskSummary != null && taskSummary.total > 0) {
    const parts: string[] = []
    if (taskSummary.done > 0) parts.push(`${taskSummary.done} done`)
    if (taskSummary.running > 0) parts.push(`${taskSummary.running} running`)
    if (taskSummary.pending > 0) parts.push(`${taskSummary.pending} pending`)
    if (taskSummary.error > 0) parts.push(`${taskSummary.error} error`)
    headerRight = ` · ${taskSummary.total} tasks: ${parts.join(' · ')}`
  }

  const workerCountLabel = `${workers.length} worker${workers.length !== 1 ? 's' : ''}`

  return (
    <Box flexDirection="column">
      {/* Top border + header */}
      <Box flexDirection="row">
        <Text color={theme.border}>{'┌─ '}</Text>
        <Text color={theme.accent} bold>{'Swarm'}</Text>
        <Text color={theme.secondary}>{'  '}{workerCountLabel}{headerRight}</Text>
        <Text color={theme.border}>{' ─'}</Text>
        <Text color={theme.border}>{'┐'}</Text>
      </Box>

      {/* Worker rows */}
      {workers.map(worker => (
        <Box key={worker.id} flexDirection="row">
          <Text color={theme.border}>{'│'}</Text>
          <WorkerRow worker={worker} />
          <Text color={theme.border}>{'│'}</Text>
        </Box>
      ))}

      {/* Bottom border */}
      <Box flexDirection="row">
        <Text color={theme.border}>{'└'}</Text>
        <Text color={theme.border}>{'─'.repeat(68)}</Text>
        <Text color={theme.border}>{'┘'}</Text>
      </Box>
    </Box>
  )
}
