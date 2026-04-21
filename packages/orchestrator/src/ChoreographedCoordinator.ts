import { EventEmitter } from 'events'
import { TaskGraph } from './TaskGraph.js'
import type { Task } from './TaskGraph.js'
import { WorkerPool } from './WorkerPool.js'
import type { CoordinatorEvent } from './Coordinator.js'

// ---------------------------------------------------------------------------
// Topo sort helper
// ---------------------------------------------------------------------------

function topoSort(tasks: Task[]): Task[] {
  const byId = new Map(tasks.map(t => [t.id, t]))
  const result: Task[] = []
  const visited = new Set<string>()

  function visit(task: Task): void {
    if (visited.has(task.id)) return
    visited.add(task.id)
    for (const depId of task.dependsOn) {
      const dep = byId.get(depId)
      if (dep) visit(dep)
    }
    result.push(task)
  }

  for (const task of tasks) {
    visit(task)
  }

  return result
}

// ---------------------------------------------------------------------------
// ChoreographedCoordinator
// ---------------------------------------------------------------------------

/**
 * ChoreographedCoordinator — runs tasks as a linear pipeline.
 *
 * Unlike the parallel Coordinator, tasks execute one-by-one in dependency
 * order. Each task receives the previous task's output as additional context,
 * enabling each step to build on the last (like a chain-of-thought pipeline).
 *
 * Pipeline prompt injection:
 *   Task 1: original description
 *   Task 2: description + "\n\n---\nOutput from previous step:\n" + task1.result
 *   Task N: description + "\n\n---\nOutput from previous step:\n" + taskN-1.result
 *
 * Workers are drawn from the pool in round-robin order. All the same
 * CoordinatorEvent types are emitted so the TUI needs no special casing.
 */
export class ChoreographedCoordinator extends EventEmitter {
  private stopped = false

  constructor(
    private graph: TaskGraph,
    private pool: WorkerPool,
  ) {
    super()
  }

  async run(): Promise<void> {
    this.stopped = false

    const ordered = topoSort(this.graph.getAllTasks())
    let previousOutput: string | undefined

    for (const task of ordered) {
      if (this.stopped) break
      if (task.status === 'done' || task.status === 'skipped') continue

      // Find an idle worker (use round-robin — just take the first idle one)
      const worker = this.pool.getIdleWorkers()[0]
      if (!worker) {
        // Wait briefly for a worker to become free (shouldn't happen in sequential mode)
        await new Promise<void>(resolve => setTimeout(resolve, 50))
        const retry = this.pool.getIdleWorkers()[0]
        if (!retry) {
          this.graph.updateStatus(task.id, 'error', undefined, 'No idle worker available')
          this.emit('coordinator_event', {
            type: 'task_error',
            taskId: task.id,
            workerId: 'unknown',
            error: 'No idle worker available',
          } satisfies CoordinatorEvent)
          continue
        }
      }

      const w = this.pool.getIdleWorkers()[0]!
      const prompt = previousOutput
        ? `${task.description}\n\n---\nOutput from previous step:\n${previousOutput}`
        : task.description

      this.graph.updateStatus(task.id, 'running')
      task.assignedAgentId = w.config.id
      this.pool.assignTask(w.config.id, task.id)

      this.emit('coordinator_event', {
        type: 'task_assigned',
        taskId: task.id,
        workerId: w.config.id,
      } satisfies CoordinatorEvent)

      let accumulatedText = ''
      let taskErrored = false

      try {
        for await (const event of w.agent.run(prompt)) {
          if (this.stopped) break

          this.emit('coordinator_event', {
            type: 'task_progress',
            taskId: task.id,
            workerId: w.config.id,
            event,
          } satisfies CoordinatorEvent)

          if (event.type === 'text') {
            accumulatedText += event.delta
          } else if (event.type === 'error') {
            this.graph.updateStatus(task.id, 'error', undefined, event.message)
            this.pool.releaseWorker(w.config.id)
            this.emit('coordinator_event', {
              type: 'task_error',
              taskId: task.id,
              workerId: w.config.id,
              error: event.message,
            } satisfies CoordinatorEvent)
            taskErrored = true
            break
          } else if (event.type === 'done') {
            this.graph.updateStatus(task.id, 'done', accumulatedText)
            this.pool.releaseWorker(w.config.id)
            this.emit('coordinator_event', {
              type: 'task_complete',
              taskId: task.id,
              workerId: w.config.id,
              result: accumulatedText,
            } satisfies CoordinatorEvent)
            previousOutput = accumulatedText
            break
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.graph.updateStatus(task.id, 'error', undefined, message)
        this.pool.releaseWorker(w.config.id)
        this.emit('coordinator_event', {
          type: 'task_error',
          taskId: task.id,
          workerId: w.config.id,
          error: message,
        } satisfies CoordinatorEvent)
        taskErrored = true
      }

      // Reset accumulated text for next task
      if (!taskErrored) accumulatedText = ''
    }

    if (!this.stopped) {
      this.emit('coordinator_event', {
        type: 'swarm_complete',
        summary: this.graph.getSummary(),
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
