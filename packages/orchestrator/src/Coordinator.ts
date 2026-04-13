import { EventEmitter } from 'events'
import { TaskGraph } from './TaskGraph.js'
import type { Task } from './TaskGraph.js'
import { WorkerPool } from './WorkerPool.js'
import type { TurnEvent } from './QueryEngine.js'

export type CoordinatorEvent =
  | { type: 'task_assigned'; taskId: string; workerId: string }
  | { type: 'task_progress'; taskId: string; workerId: string; event: TurnEvent }
  | { type: 'task_complete'; taskId: string; workerId: string; result: string }
  | { type: 'task_error'; taskId: string; workerId: string; error: string }
  | { type: 'swarm_complete'; summary: ReturnType<TaskGraph['getSummary']> }
  | { type: 'swarm_error'; message: string }

export class Coordinator extends EventEmitter {
  private stopped = false
  // Map of taskId -> resolve function for in-flight task promises
  private runningResolvers: Map<string, () => void> = new Map()

  constructor(
    private graph: TaskGraph,
    private pool: WorkerPool,
  ) {
    super()
  }

  async run(): Promise<void> {
    this.stopped = false

    // Set of promises for currently running tasks; each resolves when its task finishes
    const runningPromises: Map<string, Promise<void>> = new Map()

    while (!this.stopped) {
      if (this.graph.isComplete()) {
        this.emit('coordinator_event', {
          type: 'swarm_complete',
          summary: this.graph.getSummary(),
        } satisfies CoordinatorEvent)
        break
      }

      const readyTasks = this.graph.getReadyTasks()
      const idleWorkers = this.pool.getIdleWorkers()

      // Pair up ready tasks with idle workers
      const pairs = Math.min(readyTasks.length, idleWorkers.length)
      for (let i = 0; i < pairs; i++) {
        const task = readyTasks[i]!
        const worker = idleWorkers[i]!

        // Mark task running and assign worker
        this.graph.updateStatus(task.id, 'running')
        task.assignedAgentId = worker.config.id
        this.pool.assignTask(worker.config.id, task.id)

        this.emit('coordinator_event', {
          type: 'task_assigned',
          taskId: task.id,
          workerId: worker.config.id,
        } satisfies CoordinatorEvent)

        // Run the task asynchronously; wrap in a promise that resolves when done
        const taskPromise = new Promise<void>(resolve => {
          this.runningResolvers.set(task.id, resolve)
          this._runTask(task, worker.config.id).then(resolve).catch(resolve)
        })

        runningPromises.set(task.id, taskPromise)
      }

      // If nothing is running and nothing is ready, we have a deadlock or all tasks are done
      if (runningPromises.size === 0) {
        // Check if there are still pending tasks — if so, it's a deadlock (e.g. circular deps)
        const summary = this.graph.getSummary()
        if (summary.pending > 0) {
          this.emit('coordinator_event', {
            type: 'swarm_error',
            message: `Deadlock detected: ${summary.pending} tasks are pending but none are ready to run`,
          } satisfies CoordinatorEvent)
        } else {
          this.emit('coordinator_event', {
            type: 'swarm_complete',
            summary,
          } satisfies CoordinatorEvent)
        }
        break
      }

      // Wait for any one running task to complete, then re-evaluate
      await Promise.race(runningPromises.values())

      // Remove completed tasks from runningPromises
      for (const [taskId, promise] of runningPromises) {
        const task = this.graph.getTask(taskId)
        if (task && (task.status === 'done' || task.status === 'error' || task.status === 'skipped')) {
          runningPromises.delete(taskId)
          this.runningResolvers.delete(taskId)
        }
      }
    }
  }

  private async _runTask(task: Task, workerId: string): Promise<void> {
    const worker = this.pool.getWorker(workerId)
    if (!worker) return

    let accumulatedText = ''

    try {
      for await (const event of worker.agent.run(task.description)) {
        if (this.stopped) break

        this.emit('coordinator_event', {
          type: 'task_progress',
          taskId: task.id,
          workerId,
          event,
        } satisfies CoordinatorEvent)

        if (event.type === 'text') {
          accumulatedText += event.delta
        } else if (event.type === 'error') {
          this.graph.updateStatus(task.id, 'error', undefined, event.message)
          this.pool.releaseWorker(workerId)
          this.emit('coordinator_event', {
            type: 'task_error',
            taskId: task.id,
            workerId,
            error: event.message,
          } satisfies CoordinatorEvent)
          return
        } else if (event.type === 'done') {
          this.graph.updateStatus(task.id, 'done', accumulatedText)
          this.pool.releaseWorker(workerId)
          this.emit('coordinator_event', {
            type: 'task_complete',
            taskId: task.id,
            workerId,
            result: accumulatedText,
          } satisfies CoordinatorEvent)
          return
        }
      }

      // If we exited the loop without hitting 'done' or 'error' (e.g. stopped)
      if (task.status === 'running') {
        this.graph.updateStatus(task.id, 'error', undefined, 'Task was stopped before completion')
        this.pool.releaseWorker(workerId)
        this.emit('coordinator_event', {
          type: 'task_error',
          taskId: task.id,
          workerId,
          error: 'Task was stopped before completion',
        } satisfies CoordinatorEvent)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.graph.updateStatus(task.id, 'error', undefined, message)
      this.pool.releaseWorker(workerId)
      this.emit('coordinator_event', {
        type: 'task_error',
        taskId: task.id,
        workerId,
        error: message,
      } satisfies CoordinatorEvent)
    }
  }

  stop(): void {
    this.stopped = true
  }

  getState(): {
    tasks: ReturnType<TaskGraph['getAllTasks']>
    workers: ReturnType<WorkerPool['getStatus']>
    summary: ReturnType<TaskGraph['getSummary']>
  } {
    return {
      tasks: this.graph.getAllTasks(),
      workers: this.pool.getStatus(),
      summary: this.graph.getSummary(),
    }
  }
}
