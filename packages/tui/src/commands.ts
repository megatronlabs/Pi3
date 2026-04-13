/** A slash command that triggers a named action in the host app. */
export interface ActionCommand {
  type: 'action'
  name: string        // e.g. 'clear'
  description: string
}

/** A slash command that fills the input with a prefix for the user to complete. */
export interface FillCommand {
  type: 'fill'
  name: string
  description: string
  fill: string        // what gets inserted into the input, e.g. '/search '
}

export type SlashCommand = ActionCommand | FillCommand

export const BUILT_IN_COMMANDS: SlashCommand[] = [
  { type: 'action', name: 'clear',           description: 'Clear the chat history' },
  { type: 'action', name: 'compact',         description: 'Compact conversation history to save context' },
  { type: 'action', name: 'config',          description: 'Show current config and working directory' },
  { type: 'action', name: 'exit',            description: 'Exit Pi3' },
  { type: 'action', name: 'preset',          description: 'Show or switch model preset (quality / fast / local / mixed)' },
  { type: 'action', name: 'help',            description: 'Show available commands and keybindings' },
  { type: 'action', name: 'mcp',             description: 'Show MCP server status' },
  { type: 'action', name: 'model',           description: 'Switch provider and model' },
  { type: 'action', name: 'status',          description: 'Show session status (context, tokens, history)' },
  { type: 'action', name: 'training-wheels', description: 'Show training wheels status' },
]

export function filterCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase()
  return BUILT_IN_COMMANDS.filter(c => c.name.startsWith(q))
}
