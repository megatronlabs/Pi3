import { mkdir } from 'node:fs/promises'
import { openSync, closeSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Spawn the Hub Server as a detached background process that outlives the CLI.
 *
 * - Logs go to <dataDir>/hub.log (append)
 * - The process is unref()'d so the spawning CLI exits normally
 * - Safe to call multiple times — callers should check health first
 */
export async function spawnHubDaemon(port: number, dataDir: string): Promise<void> {
  // Ensure data dir exists before opening the log file
  await mkdir(dataDir, { recursive: true })

  const logPath    = join(dataDir, 'hub.log')
  const serverPath = new URL('./server.ts', import.meta.url).pathname

  // Open log file for append; parent closes its copy after spawn
  const logFd = openSync(logPath, 'a')

  try {
    const proc = Bun.spawn(['bun', 'run', serverPath], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: {
        ...process.env,
        SWARM_HUB_PORT:     String(port),
        SWARM_HUB_DATA_DIR: dataDir,
      },
    })
    // Detach from parent's event loop — hub outlives the CLI
    proc.unref()
  } finally {
    closeSync(logFd)
  }
}
