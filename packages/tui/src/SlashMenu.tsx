import React from 'react'
import { Box, Text } from 'ink'
import { useTheme } from './theme.js'
import type { SlashCommand } from './commands.js'

interface SlashMenuProps {
  commands: SlashCommand[]
  selectedIndex: number
}

export function SlashMenu({ commands, selectedIndex }: SlashMenuProps): React.JSX.Element | null {
  const theme = useTheme()

  if (commands.length === 0) return null

  return (
    <Box flexDirection="column" marginBottom={0}>
      {commands.map((cmd, i) => {
        const isSelected = i === selectedIndex
        return (
          <Box key={cmd.name} flexDirection="row" paddingX={2}>
            <Text
              color={isSelected ? theme.accent : theme.secondary}
              bold={isSelected}
            >
              {'/' + cmd.name.padEnd(20)}
            </Text>
            <Text color={isSelected ? theme.secondary : theme.muted}>
              {cmd.description}
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}
