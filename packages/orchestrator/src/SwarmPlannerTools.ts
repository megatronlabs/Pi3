import { z } from 'zod'
import type { AgentTool } from './AgentTool.js'
import { TaskGraph } from './TaskGraph.js'

// ── SwarmAddTaskTool ─────────────────────────────────────────────────────────
// Adds a task to the shared TaskGraph. The agent calls this for each subtask.

const AddTaskSchema = z.object({
  id: z.string().describe('Short unique task id, e.g. "auth", "tests", "docs"'),
  title: z.string().describe('One-line task title'),
  description: z.string().describe('Full description of what the worker agent should do'),
  depends_on: z
    .array(z.string())
    .optional()
    .transform(v => v ?? [])
    .describe('IDs of tasks that must complete first'),
})

type AddTaskInput = z.output<typeof AddTaskSchema>

export class SwarmAddTaskTool implements AgentTool<AddTaskInput, string> {
  name = 'swarm_add_task'
  description =
    'Add a subtask to the swarm task graph. Call this for each parallel workstream, then call swarm_run.'
  inputSchema = AddTaskSchema as z.ZodType<AddTaskInput>

  constructor(private graph: TaskGraph) {}

  async call(input: AddTaskInput): Promise<string> {
    this.graph.addTask({
      id: input.id,
      title: input.title,
      description: input.description,
      dependsOn: input.depends_on,
    })
    return `Task "${input.id}" added (depends on: ${input.depends_on.join(', ') || 'none'})`
  }

  formatOutput(output: string): string {
    return output
  }

  requiresApproval(): boolean {
    return false
  }
}

// ── SwarmRunTool ─────────────────────────────────────────────────────────────
// Signals the App to start the Coordinator. The tool itself is a no-op —
// App detects it via the onRun callback.

const RunSchema = z.object({})

type RunInput = z.infer<typeof RunSchema>

export class SwarmRunTool implements AgentTool<RunInput, string> {
  name = 'swarm_run'
  description =
    'Start the swarm — launches worker agents to execute all added tasks in parallel.'
  inputSchema = RunSchema

  constructor(private onRun: () => void) {}

  async call(): Promise<string> {
    this.onRun()
    return 'Swarm started. Workers are executing tasks.'
  }

  formatOutput(output: string): string {
    return output
  }

  requiresApproval(): boolean {
    return false
  }
}
