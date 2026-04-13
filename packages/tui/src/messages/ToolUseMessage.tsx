import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import figures from 'figures'
import { useTheme } from '../theme.js'
import type { MessageContent } from '../types.js'

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

function asStr(v: unknown): string {
  return typeof v === 'string' ? v : String(v ?? '')
}

function formatToolInput(name: string, input: unknown): { prefix: string; inputStr: string } {
  if (!input || typeof input !== 'object') {
    return { prefix: '', inputStr: asStr(input) }
  }
  const inp = input as Record<string, unknown>

  switch (name) {
    case 'bash':
      return { prefix: '$ ', inputStr: asStr(inp.command) }
    case 'file_read':
      return { prefix: '📄 ', inputStr: asStr(inp.path) }
    case 'file_write':
      return { prefix: '✏️  ', inputStr: asStr(inp.path) }
    case 'file_edit':
      return { prefix: '✏️  ', inputStr: asStr(inp.path) }
    case 'glob':
      return { prefix: '🔍 ', inputStr: asStr(inp.pattern) }
    case 'grep':
      return { prefix: '🔍 ', inputStr: `${asStr(inp.pattern)}${inp.path ? ` in ${asStr(inp.path)}` : ''}` }
    case 'spawn_agent':
      return { prefix: '🤖 ', inputStr: asStr(inp.task).slice(0, 80) }
    default: {
      // Generic: show key=value pairs on one line, skip long values
      const parts = Object.entries(inp)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
        .join(' ')
      return { prefix: '', inputStr: parts }
    }
  }
}

interface ToolUseMessageProps {
  block: Extract<MessageContent, { kind: 'tool_use' }>
}

export function ToolUseMessage({ block }: ToolUseMessageProps): React.JSX.Element {
  const theme = useTheme()
  const [spinnerIdx, setSpinnerIdx] = useState(0)
  const isRunning = block.status === 'running' || block.status === 'pending'

  useEffect(() => {
    if (!isRunning) return
    const interval = setInterval(() => {
      setSpinnerIdx(i => (i + 1) % SPINNER_FRAMES.length)
    }, 80)
    return () => clearInterval(interval)
  }, [isRunning])

  const statusIcon =
    block.status === 'done'
      ? figures.tick
      : block.status === 'error'
        ? figures.cross
        : SPINNER_FRAMES[spinnerIdx]

  const statusColor =
    block.status === 'done'
      ? theme.success
      : block.status === 'error'
        ? theme.error
        : theme.tool

  // Format input display based on tool type
  const { prefix, inputStr } = formatToolInput(block.name, block.input)

  return (
    <Box flexDirection="column" marginY={0}>
      <Box flexDirection="row">
        <Text color={statusColor}>{statusIcon} </Text>
        <Text color={theme.tool} bold>{block.name}</Text>
        {block.status !== 'done' && (
          <>
            <Text color={theme.muted}>{'  ('}</Text>
            <Text color={theme.secondary}>{block.status}</Text>
            <Text color={theme.muted}>{')'}</Text>
          </>
        )}
      </Box>
      {inputStr.length > 0 && (
        <Box marginLeft={2}>
          <Text color={theme.secondary}>{prefix}{inputStr}</Text>
        </Box>
      )}
    </Box>
  )
}
