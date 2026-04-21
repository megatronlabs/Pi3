#!/usr/bin/env bun
/**
 * packages/hub/src/server.ts
 *
 * Standalone Hub Server entrypoint. Spawned as a detached background process
 * by the CLI when config.hub.persist = true. Survives CLI exit and is reused
 * by subsequent CLI sessions.
 *
 * Configuration via environment variables (set by the spawning CLI):
 *   SWARM_HUB_PORT      — port to listen on (default 7777)
 *   SWARM_HUB_DATA_DIR  — absolute path to data directory (default ~/.swarm/hub)
 */
import { homedir } from 'node:os'
import { mkdir } from 'node:fs/promises'
import { HubServer } from './HubServer.js'

function expandPath(p: string): string {
  return p.startsWith('~') ? homedir() + p.slice(1) : p
}

const port    = Number(process.env.SWARM_HUB_PORT ?? '7777')
const dataDir = expandPath(process.env.SWARM_HUB_DATA_DIR ?? '~/.swarm/hub')

// Ensure the data directory exists before the server starts.
// daemon.ts also creates it, but this guard makes the server safe to launch
// standalone (e.g. bun run packages/hub/src/server.ts directly).
await mkdir(dataDir, { recursive: true })

const server = new HubServer({ port, dataDir })

await server.start()

// Graceful shutdown on signals
async function shutdown(): Promise<void> {
  await server.stop()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT',  shutdown)

// Keep the process alive indefinitely — Bun.serve() itself keeps the event loop
// open, but this makes the intent explicit.
