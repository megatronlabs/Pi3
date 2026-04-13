export type TaskStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped'

export interface Task {
  id: string
  title: string
  description: string
  dependsOn: string[]
  status: TaskStatus
  assignedAgentId?: string
  result?: string
  error?: string
  startedAt?: Date
  completedAt?: Date
}

export class TaskGraph {
  private tasks: Map<string, Task> = new Map()

  addTask(task: Omit<Task, 'status'>): Task {
    const newTask: Task = { ...task, status: 'pending' }
    this.tasks.set(task.id, newTask)
    return newTask
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id)
  }

  getAllTasks(): Task[] {
    return Array.from(this.tasks.values())
  }

  getReadyTasks(): Task[] {
    return Array.from(this.tasks.values()).filter(task => {
      if (task.status !== 'pending') return false
      return task.dependsOn.every(depId => {
        const dep = this.tasks.get(depId)
        return dep?.status === 'done'
      })
    })
  }

  getRunningTasks(): Task[] {
    return Array.from(this.tasks.values()).filter(task => task.status === 'running')
  }

  updateStatus(id: string, status: TaskStatus, result?: string, error?: string): void {
    const task = this.tasks.get(id)
    if (!task) throw new Error(`Task "${id}" not found`)

    task.status = status

    if (result !== undefined) task.result = result
    if (error !== undefined) task.error = error

    if (status === 'running') {
      task.startedAt = new Date()
    } else if (status === 'done' || status === 'error' || status === 'skipped') {
      task.completedAt = new Date()
    }
  }

  isComplete(): boolean {
    return Array.from(this.tasks.values()).every(
      task => task.status === 'done' || task.status === 'error' || task.status === 'skipped',
    )
  }

  getSummary(): { total: number; pending: number; running: number; done: number; error: number } {
    const all = Array.from(this.tasks.values())
    return {
      total: all.length,
      pending: all.filter(t => t.status === 'pending').length,
      running: all.filter(t => t.status === 'running').length,
      done: all.filter(t => t.status === 'done').length,
      error: all.filter(t => t.status === 'error').length,
    }
  }
}
