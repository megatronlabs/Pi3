import React from 'react'
import { Box, Text } from 'ink'
import { useTheme } from './theme.js'
import type { AgentMessage, AgentMessageType } from '@swarm/bus'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommLogProps {
  messages: AgentMessage[]
  isVisible: boolean
  /** Maximum rows to display (newest last). Default 12. */
  maxRows?: number
}

// ---------------------------------------------------------------------------
// Styling helpers
// ---------------------------------------------------------------------------

const TYPE_BADGE: Record<AgentMessageType, string> = {
  directive:  'directive',
  query:      'query   ',
  reply:      'reply   ',
  result:     'result  ',
  status:     'status  ',
  vote:       'vote    ',
  broadcast:  'bcast   ',
}

function typeColor(theme: ReturnType<typeof useTheme>, type: AgentMessageType): string {
  switch (type) {
    case 'query':     return theme.accent
    case 'reply':     return theme.success
    case 'directive': return theme.primary
    case 'result':    return theme.tool
    case 'vote':      return theme.warning
    case 'status':    return theme.secondary
    case 'broadcast': return theme.thinking
  }
}

function truncate(s: string, max: number): string {
  // Strip any newlines for single-line display
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat
}

function shortId(id: string): string {
  return id.slice(-6)
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function MessageRow({ msg }: { msg: AgentMessage }): React.JSX.Element {
  const theme = useTheme()
  const badge = TYPE_BADGE[msg.type]
  const color = typeColor(theme, msg.type)
  const from  = msg.from.padEnd(10).slice(0, 10)
  const to    = msg.to.padEnd(12).slice(0, 12)
  const body  = truncate(msg.content, 44)
  const ts    = new Date(msg.timestamp).toLocaleTimeString('en-US', { hour12: false, timeStyle: 'medium' })

  return (
    <Box flexDirection="row" paddingX={1}>
      <Text color={theme.muted}>{ts} </Text>
      <Text color={theme.secondary}>{from}</Text>
      <Text color={theme.muted}>{' → '}</Text>
      <Text color={theme.secondary}>{to}</Text>
      <Text color={theme.muted}>{' '}</Text>
      <Text color={color}>[{badge}]</Text>
      <Text color={theme.muted}>{' '}</Text>
      <Text color={theme.primary}>{body}</Text>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function CommLog({ messages, isVisible, maxRows = 12 }: CommLogProps): React.JSX.Element | null {
  const theme = useTheme()

  if (!isVisible || messages.length === 0) return null

  const visible = messages.slice(-maxRows)
  const label = `${messages.length} message${messages.length !== 1 ? 's' : ''}`

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text color={theme.border}>{'┌─ '}</Text>
        <Text color={theme.accent} bold>{'Comms'}</Text>
        <Text color={theme.secondary}>{'  '}{label}</Text>
        <Text color={theme.muted}>{' · Ctrl+L to close'}</Text>
        <Text color={theme.border}>{' ─┐'}</Text>
      </Box>

      {visible.map(msg => (
        <Box key={msg.id} flexDirection="row">
          <Text color={theme.border}>{'│'}</Text>
          <MessageRow msg={msg} />
          <Text color={theme.border}>{'│'}</Text>
        </Box>
      ))}

      <Box flexDirection="row">
        <Text color={theme.border}>{'└'}</Text>
        <Text color={theme.border}>{'─'.repeat(78)}</Text>
        <Text color={theme.border}>{'┘'}</Text>
      </Box>
    </Box>
  )
}
