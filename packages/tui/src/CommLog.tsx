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
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat
}

// ---------------------------------------------------------------------------
// Display item types
// ---------------------------------------------------------------------------

/** A single standalone message (non-banter) */
interface FlatItem {
  kind: 'flat'
  msg: AgentMessage
}

/** A query + its matched reply, displayed as a thread */
interface ThreadItem {
  kind: 'thread'
  query: AgentMessage
  reply: AgentMessage | null
}

type DisplayItem = FlatItem | ThreadItem

// ---------------------------------------------------------------------------
// Grouping logic
// ---------------------------------------------------------------------------

/**
 * Converts a flat message list into display items.
 *
 * query/reply pairs linked by correlationId are merged into ThreadItems.
 * All other message types stay as FlatItems. Replies that are part of a
 * thread are removed from the flat list — they render under their query.
 */
function groupMessages(messages: AgentMessage[]): DisplayItem[] {
  // Map correlationId → reply message
  const replyByCorr = new Map<string, AgentMessage>()
  for (const msg of messages) {
    if (msg.type === 'reply' && msg.correlationId) {
      replyByCorr.set(msg.correlationId, msg)
    }
  }

  // IDs of replies that have been claimed by a query
  const claimedReplyIds = new Set<string>()

  const items: DisplayItem[] = []
  for (const msg of messages) {
    // Skip replies already claimed by a query
    if (msg.type === 'reply' && msg.correlationId && replyByCorr.has(msg.correlationId)) {
      const reply = replyByCorr.get(msg.correlationId)!
      if (reply.id === msg.id) continue // will be emitted under the query
    }

    if (msg.type === 'query') {
      const reply = replyByCorr.get(msg.id) ?? null
      if (reply) claimedReplyIds.add(reply.id)
      items.push({ kind: 'thread', query: msg, reply })
    } else if (msg.type === 'reply' && !claimedReplyIds.has(msg.id)) {
      // Orphan reply (no matching query in window)
      items.push({ kind: 'flat', msg })
    } else if (msg.type !== 'reply') {
      items.push({ kind: 'flat', msg })
    }
  }

  return items
}

// ---------------------------------------------------------------------------
// Row components
// ---------------------------------------------------------------------------

function MessageRow({
  msg,
  indent = false,
}: {
  msg: AgentMessage
  indent?: boolean
}): React.JSX.Element {
  const theme = useTheme()
  const badge = TYPE_BADGE[msg.type]
  const color = typeColor(theme, msg.type)
  const from  = msg.from.padEnd(10).slice(0, 10)
  const to    = msg.to.padEnd(12).slice(0, 12)
  const body  = truncate(msg.content, indent ? 40 : 44)
  const ts    = new Date(msg.timestamp).toLocaleTimeString('en-US', { hour12: false, timeStyle: 'medium' })

  return (
    <Box flexDirection="row" paddingX={1}>
      <Text color={theme.muted}>{ts} </Text>
      {indent && <Text color={theme.muted}>{'  └─ '}</Text>}
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

  const allItems = groupMessages(messages)
  // Each ThreadItem with a reply takes 2 rows; trim to fit maxRows
  const visible: DisplayItem[] = []
  let rowCount = 0
  for (let i = allItems.length - 1; i >= 0 && rowCount < maxRows; i--) {
    const item = allItems[i]!
    const rows = item.kind === 'thread' && item.reply ? 2 : 1
    if (rowCount + rows > maxRows) break
    visible.unshift(item)
    rowCount += rows
  }

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

      {visible.map(item => {
        if (item.kind === 'flat') {
          return (
            <Box key={item.msg.id} flexDirection="row">
              <Text color={theme.border}>{'│'}</Text>
              <MessageRow msg={item.msg} />
              <Text color={theme.border}>{'│'}</Text>
            </Box>
          )
        }
        return (
          <Box key={item.query.id} flexDirection="column">
            <Box flexDirection="row">
              <Text color={theme.border}>{'│'}</Text>
              <MessageRow msg={item.query} />
              <Text color={theme.border}>{'│'}</Text>
            </Box>
            {item.reply && (
              <Box flexDirection="row">
                <Text color={theme.border}>{'│'}</Text>
                <MessageRow msg={item.reply} indent={true} />
                <Text color={theme.border}>{'│'}</Text>
              </Box>
            )}
          </Box>
        )
      })}

      <Box flexDirection="row">
        <Text color={theme.border}>{'└'}</Text>
        <Text color={theme.border}>{'─'.repeat(78)}</Text>
        <Text color={theme.border}>{'┘'}</Text>
      </Box>
    </Box>
  )
}
