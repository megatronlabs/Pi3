import React from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../theme.js'
import type { ChatMessage } from '../types.js'

interface UserMessageProps {
  message: ChatMessage
}

export function UserMessage({ message }: UserMessageProps): React.JSX.Element {
  const theme = useTheme()

  const textContent = message.content
    .filter(c => c.kind === 'text')
    .map(c => (c.kind === 'text' ? c.text : ''))
    .join('\n')

  return (
    <Box flexDirection="row" marginY={0}>
      <Text color={theme.user} bold>{'user'}</Text>
      <Text color={theme.muted}>{' · '}</Text>
      <Text color={theme.primary}>{textContent}</Text>
    </Box>
  )
}
