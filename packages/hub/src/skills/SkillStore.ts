import { promises as fs } from 'node:fs'
import { join } from 'node:path'

export interface Skill {
  name: string        // slug, e.g. "review-pr" — used as the slash command name
  description: string // shown in slash menu
  prompt: string      // the prompt sent to the agent when the skill is invoked
  createdAt: string   // ISO 8601
}

export class SkillStore {
  constructor(private dir: string) {}

  async load(): Promise<Skill[]> {
    try {
      await fs.mkdir(this.dir, { recursive: true })
      const files = (await fs.readdir(this.dir)).filter(f => f.endsWith('.json')).sort()
      const skills: Skill[] = []
      for (const file of files) {
        try {
          const raw = await fs.readFile(join(this.dir, file), 'utf8')
          skills.push(JSON.parse(raw) as Skill)
        } catch { /* skip corrupt files */ }
      }
      return skills
    } catch {
      return []
    }
  }

  async save(skill: Skill): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    const filename = `${skill.name.replace(/[^a-zA-Z0-9-_]/g, '-')}.json`
    const tmpPath = join(this.dir, `${filename}.tmp`)
    const finalPath = join(this.dir, filename)
    await fs.writeFile(tmpPath, JSON.stringify(skill, null, 2), 'utf8')
    await fs.rename(tmpPath, finalPath)
  }

  async remove(name: string): Promise<void> {
    const filename = `${name.replace(/[^a-zA-Z0-9-_]/g, '-')}.json`
    try {
      await fs.unlink(join(this.dir, filename))
    } catch { /* already gone */ }
  }
}
