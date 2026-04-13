import React from 'react'
import { Box, Text } from 'ink'
import { useTheme } from './theme.js'
import type { ChatMessage } from './types.js'
import { UserMessage } from './messages/UserMessage.js'
import { AssistantMessage } from './messages/AssistantMessage.js'
import { ToolUseMessage } from './messages/ToolUseMessage.js'

interface MessageListProps {
  messages: ChatMessage[]
  maxHeight: number
}

export function MessageList({ messages, maxHeight }: MessageListProps): React.JSX.Element {
  const theme = useTheme()

  // Simple approach: take the last N messages that could fit.
  // Each message takes at least 1 row; we slice conservatively.
  const visibleMessages = messages.slice(-maxHeight)

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      {visibleMessages.length === 0 ? (
        <Box flexGrow={1} alignItems="center" justifyContent="center">
          <Text color={theme.muted}>{'No messages yet. Start typing below.'}</Text>
        </Box>
      ) : (
        visibleMessages.map(message => (
          <Box key={message.id} flexDirection="column" marginBottom={1}>
            {message.role === 'user' && <UserMessage message={message} />}
            {message.role === 'assistant' && (
              <>
                <AssistantMessage message={message} />
                {message.content
                  .filter(b => b.kind === 'tool_use')
                  .map((b, i) =>
                    b.kind === 'tool_use' ? (
                      <ToolUseMessage key={i} block={b} />
                    ) : null,
                  )}
              </>
            )}
            {message.role === 'system' && (
              <Box flexDirection="row">
                <Text color={theme.muted} italic>{'system: '}</Text>
                {message.content
                  .filter(b => b.kind === 'text')
                  .map((b, i) =>
                    b.kind === 'text' ? (
                      <Text key={i} color={theme.muted}>{b.text}</Text>
                    ) : null,
                  )}
              </Box>
            )}
            {message.content.some(b => b.kind === 'error') && (
              <Box flexDirection="row" marginLeft={2}>
                <Text color={theme.error}>
                  {message.content
                    .filter(b => b.kind === 'error')
                    .map(b => (b.kind === 'error' ? b.message : ''))
                    .join('\n')}
                </Text>
              </Box>
            )}
          </Box>
        ))
      )}
    </Box>
  )
}
