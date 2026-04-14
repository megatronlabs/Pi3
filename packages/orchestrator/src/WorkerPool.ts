import { Agent } from './Agent.js'
import type { AgentConfig } from './Agent.js'
import type { AgentTool } from './AgentTool.js'
import type { Provider } from '@swarm/providers'
import type { MessageBus, AgentRegistry } from '@swarm/bus'

export interface WorkerConfig {
  id: string
  name: string
  provider: Provider
  model: string
  tools?: AgentTool[]
  systemPrompt?: string
  workingDir?: string
  bus?: MessageBus
  registry?: AgentRegistry
}

export interface Worker {
  agent: Agent
  config: WorkerConfig
  busy: boolean
  currentTaskId?: string
}

export class WorkerPool {
  private workers: Map<string, Worker> = new Map()

  addWorker(config: WorkerConfig): Worker {
    const agentConfig: AgentConfig = {
      id: config.id,
      name: config.name,
      provider: config.provider,
      model: config.model,
      tools: config.tools,
      systemPrompt: config.systemPrompt,
      workingDir: config.workingDir,
      bus: config.bus,
      registry: config.registry,
    }

    const agent = new Agent(agentConfig)
    const worker: Worker = { agent, config, busy: false }
    this.workers.set(config.id, worker)
    return worker
  }

  removeWorker(id: string): void {
    this.workers.delete(id)
  }

  getWorker(id: string): Worker | undefined {
    return this.workers.get(id)
  }

  getAllWorkers(): Worker[] {
    return Array.from(this.workers.values())
  }

  getIdleWorkers(): Worker[] {
    return Array.from(this.workers.values()).filter(w => !w.busy)
  }

  getBusyWorkers(): Worker[] {
    return Array.from(this.workers.values()).filter(w => w.busy)
  }

  assignTask(workerId: string, taskId: string): void {
    const worker = this.workers.get(workerId)
    if (!worker) throw new Error(`Worker "${workerId}" not found`)
    worker.busy = true
    worker.currentTaskId = taskId
  }

  releaseWorker(workerId: string): void {
    const worker = this.workers.get(workerId)
    if (!worker) throw new Error(`Worker "${workerId}" not found`)
    worker.busy = false
    worker.currentTaskId = undefined
  }

  getStatus(): Array<{
    id: string
    name: string
    model: string
    providerId: string
    busy: boolean
    currentTaskId?: string
    agentStatus: string
  }> {
    return Array.from(this.workers.values()).map(w => ({
      id: w.config.id,
      name: w.config.name,
      model: w.config.model,
      providerId: w.config.provider.id,
      busy: w.busy,
      currentTaskId: w.currentTaskId,
      agentStatus: w.agent.status,
    }))
  }
}
