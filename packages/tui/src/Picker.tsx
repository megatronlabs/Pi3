import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { useTheme } from './theme.js'

export interface PickerItem<T = string> {
  label: string
  value: T
  description?: string
}

interface PickerProps<T> {
  items: PickerItem<T>[]
  title: string
  onSelect: (item: PickerItem<T>) => void
  onCancel: () => void
  selectedValue?: T
}

export function Picker<T>({ items, title, onSelect, onCancel, selectedValue }: PickerProps<T>): React.JSX.Element {
  const theme = useTheme()
  const [focusIndex, setFocusIndex] = useState<number>(() => {
    if (selectedValue === undefined) return 0
    const idx = items.findIndex(item => item.value === selectedValue)
    return idx >= 0 ? idx : 0
  })

  useInput((input, key) => {
    if (key.upArrow) {
      setFocusIndex(prev => (prev <= 0 ? items.length - 1 : prev - 1))
    } else if (key.downArrow) {
      setFocusIndex(prev => (prev >= items.length - 1 ? 0 : prev + 1))
    } else if (key.return) {
      if (items.length > 0) {
        onSelect(items[focusIndex])
      }
    } else if (key.escape) {
      onCancel()
    }
  })

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.border}
      paddingX={1}
    >
      <Box marginBottom={1}>
        <Text color={theme.accent} bold>
          {title}
        </Text>
      </Box>
      {items.map((item, index) => {
        const isFocused = index === focusIndex
        const isSelected = selectedValue !== undefined && item.value === selectedValue

        return (
          <Box key={index} flexDirection="row">
            <Text color={isFocused ? theme.accent : theme.muted}>
              {isFocused ? '▶' : ' '}
            </Text>
            <Text> </Text>
            <Text color={theme.success}>
              {isSelected ? '✓' : ' '}
            </Text>
            <Text> </Text>
            <Text
              color={isFocused ? theme.accent : theme.primary}
              bold={isFocused}
            >
              {item.label}
            </Text>
            {item.description !== undefined && (
              <>
                <Text> </Text>
                <Text color={theme.muted}>{item.description}</Text>
              </>
            )}
          </Box>
        )
      })}
    </Box>
  )
}
