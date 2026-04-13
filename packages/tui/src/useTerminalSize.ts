import { useState, useEffect } from 'react'
import { useStdout } from 'ink'

export function useTerminalSize(): { columns: number; rows: number } {
  const { stdout } = useStdout()

  const getSize = () => ({
    columns: stdout?.columns ?? process.stdout.columns ?? 80,
    rows: stdout?.rows ?? process.stdout.rows ?? 24,
  })

  const [size, setSize] = useState(getSize)

  useEffect(() => {
    const handleResize = () => {
      setSize(getSize())
    }

    process.stdout.on('resize', handleResize)
    return () => {
      process.stdout.off('resize', handleResize)
    }
  }, [stdout])

  return size
}
