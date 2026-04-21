import { promises as fs } from 'node:fs'
import { join } from 'node:path'

export interface LoadedMemory {
  content: string    // full MEMORY.md text (frontmatter + body)
  workingDir: string // from frontmatter
  sessionId: string  // from frontmatter
  timestamp: Date    // from frontmatter (falls back to file mtime)
  path: string       // absolute path to the file
}

/**
 * Parse the leading --- frontmatter block from a markdown file.
 * Returns a key→value map, or null if no frontmatter found.
 */
function parseFrontmatter(content: string): Record<string, string> | null {
  const lines = content.split('\n')
  if (lines[0]?.trim() !== '---') return null
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
  if (end === -1) return null
  const result: Record<string, string> = {}
  for (let i = 1; i < end; i++) {
    const colon = lines[i].indexOf(':')
    if (colon === -1) continue
    const key = lines[i].slice(0, colon).trim()
    const val = lines[i].slice(colon + 1).trim()
    result[key] = val
  }
  return result
}

/**
 * Scan handoffDir for MEMORY.md files whose frontmatter workingDir matches
 * the supplied workingDir. Returns the most recently timestamped match,
 * or null if the directory doesn't exist or no match is found.
 *
 * Never throws.
 */
export async function loadMemoryForDir(
  handoffDir: string,
  workingDir: string,
): Promise<LoadedMemory | null> {
  let entries: string[]
  try {
    entries = await fs.readdir(handoffDir)
  } catch {
    return null
  }

  const candidates = entries.filter(
    f => f.endsWith('.md') && f.toUpperCase().includes('MEMORY'),
  )

  const matches: LoadedMemory[] = []

  for (const filename of candidates) {
    const filePath = join(handoffDir, filename)
    try {
      const content = await fs.readFile(filePath, 'utf8')
      const fm = parseFrontmatter(content)
      if (!fm) continue
      if (fm['workingDir'] !== workingDir) continue

      const sessionId = fm['sessionId'] ?? ''
      let timestamp: Date
      if (fm['timestamp']) {
        const d = new Date(fm['timestamp'])
        timestamp = isNaN(d.getTime()) ? (await fs.stat(filePath)).mtime : d
      } else {
        timestamp = (await fs.stat(filePath)).mtime
      }

      matches.push({ content, workingDir, sessionId, timestamp, path: filePath })
    } catch {
      // skip unreadable / corrupt files
    }
  }

  if (matches.length === 0) return null

  // Return the most recently timestamped match
  matches.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
  return matches[0]!
}
