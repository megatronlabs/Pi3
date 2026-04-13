import React, { useState, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'
import { useTheme } from './theme.js'
import { SlashMenu } from './SlashMenu.js'
import { filterCommands } from './commands.js'
import type { SlashCommand } from './commands.js'

interface PromptInputProps {
  onSubmit: (value: string) => void
  onCommand?: (command: SlashCommand) => void
  onCancel?: () => void
  disabled?: boolean
  placeholder?: string
}

export function PromptInput({
  onSubmit,
  onCommand,
  onCancel,
  disabled = false,
  placeholder = 'Type a message...',
}: PromptInputProps): React.JSX.Element {
  const theme = useTheme()
  const [value, setValue] = useState('')
  const [cursorVisible, setCursorVisible] = useState(true)
  const [menuIndex, setMenuIndex] = useState(0)

  // Blink cursor
  useEffect(() => {
    if (disabled) return
    const interval = setInterval(() => {
      setCursorVisible(v => !v)
    }, 530)
    return () => clearInterval(interval)
  }, [disabled])

  // Slash menu state — active when value starts with '/'
  const slashQuery = value.startsWith('/') ? value.slice(1) : null
  const menuCommands = slashQuery !== null ? filterCommands(slashQuery) : []
  const menuOpen = menuCommands.length > 0

  // Reset selection when the list changes
  useEffect(() => {
    setMenuIndex(0)
  }, [value])

  useInput(
    (input, key) => {
      if (disabled) return

      if (key.ctrl && input === 'c') {
        process.exit(0)
      }

      // Menu navigation
      if (menuOpen) {
        if (key.upArrow) {
          setMenuIndex(i => (i - 1 + menuCommands.length) % menuCommands.length)
          return
        }
        if (key.downArrow) {
          setMenuIndex(i => (i + 1) % menuCommands.length)
          return
        }
        if (key.return) {
          const selected = menuCommands[menuIndex]
          if (selected) {
            setValue('')
            if (selected.type === 'fill') {
              setValue(selected.fill)
            } else {
              onCommand?.(selected)
            }
          }
          return
        }
        if (key.tab) {
          const selected = menuCommands[menuIndex]
          if (selected) setValue('/' + selected.name)
          return
        }
        if (key.escape) {
          setValue('')
          return
        }
      }

      if (key.return) {
        if (value.trim().length > 0) {
          onSubmit(value)
          setValue('')
        }
        return
      }

      if (key.escape) {
        setValue('')
        onCancel?.()
        return
      }

      if (key.backspace || key.delete) {
        setValue(v => v.slice(0, -1))
        return
      }

      if (!key.ctrl && !key.meta && input) {
        setValue(v => v + input)
      }
    },
    { isActive: !disabled },
  )

  const showPlaceholder = value.length === 0

  return (
    <Box flexDirection="column">
      {/* Slash command menu — appears above the input */}
      {menuOpen && (
        <SlashMenu commands={menuCommands} selectedIndex={menuIndex} />
      )}

      <Box
        flexDirection="row"
        borderStyle="single"
        borderColor={menuOpen ? theme.accent : theme.inputBorder}
        paddingX={1}
      >
        <Text color={theme.accent}>{'❯ '}</Text>
        {showPlaceholder ? (
          // Cursor sits just before the placeholder — T is always fully visible
          <>
            {!disabled && <Text color={theme.accent}>{cursorVisible ? '█' : ' '}</Text>}
            <Text color={theme.muted}>{placeholder}</Text>
          </>
        ) : (
          // User is typing — show value then cursor at end
          <>
            <Text color={value.startsWith('/') ? theme.accent : theme.primary}>{value}</Text>
            {!disabled && <Text color={theme.accent}>{cursorVisible ? '█' : ' '}</Text>}
          </>
        )}
      </Box>
    </Box>
  )
}
