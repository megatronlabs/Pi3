import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import { useTheme } from './theme.js'

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const SEP = ' │ '

interface StatusLineProps {
  appName?: string
  model: string
  provider: string
  agentCount: number
  cost?: number
  isStreaming?: boolean
  contextPct?: number
  trainingWheels?: boolean
}

function renderContextBar(pct: number | undefined): string {
  if (pct === undefined) return '█' + '░'.repeat(9)
  const filled = Math.max(1, Math.round(pct / 10))
  const empty = 10 - filled
  return '█'.repeat(filled) + '░'.repeat(empty)
}

function contextBarColor(pct: number | undefined): string {
  if (pct === undefined) return '#555555'  // muted — unknown
  if (pct >= 79) return '#f7768e'          // red
  if (pct >= 70) return '#ff9e64'          // orange
  if (pct >= 40) return '#e0af68'          // yellow
  return '#9ece6a'                          // green
}

function contextEmoji(pct: number | undefined): string {
  if (pct === undefined) return ''
  if (pct >= 85) return ' 💀'
  if (pct >= 80) return ' 😱'
  if (pct >= 70) return ' 😰'
  if (pct >= 60) return ' 😧'
  if (pct >= 50) return ' 😟'
  if (pct >= 40) return ' 😬'
  if (pct >= 30) return ' 🤔'
  if (pct >= 20) return ' 😌'
  if (pct >= 10) return ' 🙂'
  return ' 😊'
}

export function StatusLine({
  appName,
  model,
  provider,
  agentCount,
  cost,
  isStreaming = false,
  contextPct,
  trainingWheels = false,
}: StatusLineProps): React.JSX.Element {
  const theme = useTheme()
  const [spinnerIdx, setSpinnerIdx] = useState(0)

  useEffect(() => {
    if (!isStreaming) return
    const interval = setInterval(() => {
      setSpinnerIdx(i => (i + 1) % SPINNER_FRAMES.length)
    }, 80)
    return () => clearInterval(interval)
  }, [isStreaming])

  const agentStr = `${agentCount} agent${agentCount !== 1 ? 's' : ''}`
  const barColor = contextBarColor(contextPct)
  const pctLabel = contextPct !== undefined ? `${contextPct}%` : '..%'

  return (
    <Box flexDirection="row" paddingX={1}>

      {/* App icon + name */}
      {/* App icon + name */}
      {appName && <Text color={theme.thinking}>🧠 {appName}</Text>}
      {appName && <Text color={theme.muted}>{SEP}</Text>}

      {/* Streaming spinner */}
      {isStreaming && (
        <Text color={theme.accent}>{SPINNER_FRAMES[spinnerIdx]} </Text>
      )}

      {/* Model name */}
      <Text color={theme.primary} bold>{model}</Text>

      {/* Provider */}
      <Text color={theme.muted}>{' · '}</Text>
      <Text color={theme.secondary}>{provider}</Text>

      {/* Context bar — always visible; ..% until first usage event */}
      <Text color={theme.muted}>{SEP}</Text>
      <Text color={barColor}>{renderContextBar(contextPct)}</Text>
      <Text color={theme.muted}>{' '}</Text>
      <Text color={barColor}>{pctLabel + contextEmoji(contextPct)}</Text>

      {/* Agent count */}
      <Text color={theme.muted}>{SEP}</Text>
      <Text color={theme.secondary}>{agentStr}</Text>

      {/* Cost — shown whenever defined (even $0.0000) */}
      {cost !== undefined && (
        <>
          <Text color={theme.muted}>{SEP}</Text>
          <Text color={theme.success}>{`$${cost.toFixed(4)}`}</Text>
        </>
      )}

      {/* Training wheels indicator */}
      {trainingWheels && (
        <>
          <Text color={theme.muted}>{SEP}</Text>
          <Text color={theme.warning}>🎓 training wheels</Text>
        </>
      )}

    </Box>
  )
}
