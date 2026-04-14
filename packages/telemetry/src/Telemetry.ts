import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { homedir } from 'node:os'
import type { AgentMessage } from '@swarm/bus'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface TelemetryConfig {
  enabled: boolean
  /** OTLP HTTP endpoint for log export, e.g. http://localhost:4318 — empty = disabled */
  otlpEndpoint?: string
  /** Absolute path to log file. Defaults to ~/.swarm/logs/swarm.log */
  logFile?: string
  logLevel?: LogLevel
}

/** OTEL-compatible log record (subset of OTLP LogRecord) */
export interface LogRecord {
  timestamp: number                               // unix epoch ms
  traceId?: string
  spanId?: string
  parentSpanId?: string
  severityText: LogLevel
  name: string                                    // event name, e.g. "swarm.message"
  body?: string
  attributes: Record<string, string | number | boolean | undefined>
}

// ---------------------------------------------------------------------------
// Telemetry singleton
// ---------------------------------------------------------------------------

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

export class SwarmTelemetry {
  private _cfg: TelemetryConfig = { enabled: false }
  private _logPath = ''
  private _dirReady = false

  init(cfg: TelemetryConfig): void {
    this._cfg = cfg
    this._logPath = cfg.logFile
      ? cfg.logFile.replace('~', homedir())
      : `${homedir()}/.swarm/logs/swarm.log`
  }

  // -------------------------------------------------------------------------
  // Core log method
  // -------------------------------------------------------------------------

  log(record: LogRecord): void {
    if (!this._cfg.enabled) return
    const minLevel = LEVEL_ORDER[this._cfg.logLevel ?? 'info']
    if (LEVEL_ORDER[record.severityText] < minLevel) return

    const line = JSON.stringify(record) + '\n'

    // Write to file (fire-and-forget — never throw)
    this._writeToFile(line)

    // Forward to OTLP if configured
    if (this._cfg.otlpEndpoint) {
      this._sendOtlp(record)
    }
  }

  // -------------------------------------------------------------------------
  // Convenience helpers
  // -------------------------------------------------------------------------

  /** Log an inter-agent message transit */
  logMessage(msg: AgentMessage): void {
    this.log({
      timestamp: msg.timestamp.getTime(),
      traceId: msg.traceId,
      spanId: msg.spanId,
      parentSpanId: msg.parentSpanId,
      severityText: 'info',
      name: 'swarm.message',
      body: msg.content.slice(0, 500),
      attributes: {
        'agent.from': msg.from,
        'agent.to': msg.to,
        'message.type': msg.type,
        'message.id': msg.id,
        'message.language': msg.language,
        'message.correlation_id': msg.correlationId,
      },
    })
  }

  /** Log a tool execution */
  logToolCall(opts: {
    agentId: string
    toolName: string
    traceId: string
    spanId?: string
    durationMs?: number
    error?: string
  }): void {
    this.log({
      timestamp: Date.now(),
      traceId: opts.traceId,
      spanId: opts.spanId,
      severityText: opts.error ? 'error' : 'info',
      name: 'swarm.tool_call',
      body: opts.error,
      attributes: {
        'agent.id': opts.agentId,
        'tool.name': opts.toolName,
        'tool.duration_ms': opts.durationMs,
        'tool.error': opts.error,
      },
    })
  }

  /** Log a task lifecycle event */
  logTask(opts: {
    taskId: string
    event: 'assigned' | 'complete' | 'error' | 'skipped'
    agentId?: string
    traceId?: string
    detail?: string
  }): void {
    this.log({
      timestamp: Date.now(),
      traceId: opts.traceId,
      severityText: opts.event === 'error' ? 'error' : 'info',
      name: `swarm.task.${opts.event}`,
      body: opts.detail,
      attributes: {
        'task.id': opts.taskId,
        'task.event': opts.event,
        'agent.id': opts.agentId,
      },
    })
  }

  /** Log a session start/end */
  logSession(event: 'start' | 'end', sessionId: string, model: string, provider: string): void {
    this.log({
      timestamp: Date.now(),
      severityText: 'info',
      name: `swarm.session.${event}`,
      attributes: {
        'session.id': sessionId,
        'session.model': model,
        'session.provider': provider,
      },
    })
  }

  // -------------------------------------------------------------------------
  // Internal I/O
  // -------------------------------------------------------------------------

  private async _writeToFile(line: string): Promise<void> {
    try {
      if (!this._dirReady) {
        await mkdir(dirname(this._logPath), { recursive: true })
        this._dirReady = true
      }
      await appendFile(this._logPath, line, 'utf8')
    } catch {
      // Silently ignore log write failures — never crash the app for telemetry
    }
  }

  private async _sendOtlp(record: LogRecord): Promise<void> {
    if (!this._cfg.otlpEndpoint) return
    try {
      // OTLP JSON Logs format (simplified)
      const body = {
        resourceLogs: [{
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'swarm' } }] },
          scopeLogs: [{
            scope: { name: '@swarm/telemetry' },
            logRecords: [{
              timeUnixNano: String(record.timestamp * 1_000_000),
              severityText: record.severityText.toUpperCase(),
              body: { stringValue: record.body ?? record.name },
              traceId: record.traceId ?? '',
              spanId: record.spanId ?? '',
              attributes: Object.entries(record.attributes)
                .filter(([, v]) => v !== undefined)
                .map(([k, v]) => ({
                  key: k,
                  value: typeof v === 'number'
                    ? { intValue: v }
                    : { stringValue: String(v) },
                })),
            }],
          }],
        }],
      }
      await fetch(`${this._cfg.otlpEndpoint}/v1/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch {
      // Silently ignore OTLP export failures
    }
  }
}

/** Singleton — call init() once at startup */
export const telemetry = new SwarmTelemetry()
