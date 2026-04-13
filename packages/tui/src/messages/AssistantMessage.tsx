import React from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../theme.js'
import type { ChatMessage } from '../types.js'

interface AssistantMessageProps {
  message: ChatMessage
}

export function AssistantMessage({ message }: AssistantMessageProps): React.JSX.Element {
  const theme = useTheme()

  const textBlocks = message.content.filter(b => b.kind === 'text' || b.kind === 'thinking')
  // Skip rendering an empty assistant shell (tool-only turns)
  if (textBlocks.length === 0) return <Box />

  return (
    <Box flexDirection="column" marginY={0}>
      <Text color={theme.assistant} bold>{'assistant'}</Text>
      {message.content.map((block, i) => {
        if (block.kind === 'text' && block.text.trim()) {
          return (
            <Box key={i} marginLeft={2}>
              <Text color={theme.primary} wrap="wrap">{block.text.trim()}</Text>
            </Box>
          )
        }
        if (block.kind === 'thinking' && block.text.trim()) {
          return (
            <Box key={i} marginLeft={2} flexDirection="row">
              <Text color={theme.thinking} dimColor>{'<thinking> '}</Text>
              <Text color={theme.thinking} dimColor wrap="wrap">{block.text.trim()}</Text>
            </Box>
          )
        }
        return null
      })}
    </Box>
  )
}
