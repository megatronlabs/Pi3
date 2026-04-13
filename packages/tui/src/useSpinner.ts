import { useState, useEffect } from 'react'

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export function useSpinner(intervalMs: number = 80): string {
  const [idx, setIdx] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setIdx(i => (i + 1) % SPINNER_FRAMES.length)
    }, intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])

  return SPINNER_FRAMES[idx]
}
