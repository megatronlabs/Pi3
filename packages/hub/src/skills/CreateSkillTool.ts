import { z } from 'zod'
import type { Skill, SkillStore } from './SkillStore.js'

// Minimal AgentTool interface (matches @swarm/orchestrator's AgentTool)
interface AgentTool<TInput, TOutput> {
  name: string
  description: string
  inputSchema: z.ZodType<TInput>
  call(input: TInput, ctx: { workingDir: string }): Promise<TOutput>
  formatOutput(output: TOutput): string
  requiresApproval?(): boolean
}

const CreateSkillSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9-_]+$/).describe('Slug for the skill (used as /name). Only letters, numbers, hyphens, underscores.'),
  description: z.string().describe('One-line description shown in the slash menu'),
  prompt: z.string().describe('The prompt template sent to the agent when this skill is invoked. Use {input} as a placeholder for any text the user adds after the command.'),
})

type CreateSkillInput = z.infer<typeof CreateSkillSchema>

export class CreateSkillTool implements AgentTool<CreateSkillInput, string> {
  name = 'create_skill'
  description = 'Create a new reusable slash command skill that will be available in future sessions. The skill saves a prompt template to ~/.swarm/skills/.'
  inputSchema = CreateSkillSchema

  constructor(private store: SkillStore, private onCreated?: (skill: Skill) => void) {}

  async call(input: CreateSkillInput): Promise<string> {
    const skill: Skill = {
      name: input.name,
      description: input.description,
      prompt: input.prompt,
      createdAt: new Date().toISOString(),
    }
    await this.store.save(skill)
    this.onCreated?.(skill)
    return `Skill "/${input.name}" created. It will appear in the slash menu immediately and persist across sessions.`
  }

  formatOutput(output: string): string { return output }
  requiresApproval(): boolean { return false }
}
