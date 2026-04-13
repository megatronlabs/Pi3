import { z, ZodType } from 'zod'
import type { ToolSchema } from '@swarm/providers'

export interface AgentTool<TInput = unknown, TOutput = unknown> {
  name: string
  description: string
  inputSchema: ZodType<TInput>
  call(input: TInput, ctx: { workingDir: string; abortSignal?: AbortSignal }): Promise<TOutput>
  requiresApproval?(input: TInput): boolean
  /** Convert output to a string for the LLM */
  formatOutput(output: TOutput): string
}

/**
 * Convert a Zod schema to a plain JSON Schema object.
 * Handles the most common Zod types needed for tool input schemas.
 */
export function zodToJsonSchema(schema: ZodType): Record<string, unknown> {
  // Unwrap ZodOptional / ZodNullable to get the inner type
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return zodToJsonSchema(schema.unwrap())
  }

  if (schema instanceof z.ZodString) {
    return { type: 'string' }
  }

  if (schema instanceof z.ZodNumber) {
    return { type: 'number' }
  }

  if (schema instanceof z.ZodBoolean) {
    return { type: 'boolean' }
  }

  if (schema instanceof z.ZodEnum) {
    return { type: 'string', enum: schema.options as string[] }
  }

  if (schema instanceof z.ZodLiteral) {
    return { const: schema.value }
  }

  if (schema instanceof z.ZodArray) {
    return { type: 'array', items: zodToJsonSchema(schema.element) }
  }

  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, ZodType>
    const properties: Record<string, unknown> = {}
    const required: string[] = []

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value)
      // If the field is not wrapped in ZodOptional, it's required
      if (!(value instanceof z.ZodOptional)) {
        required.push(key)
      }
    }

    const result: Record<string, unknown> = { type: 'object', properties }
    if (required.length > 0) {
      result['required'] = required
    }
    return result
  }

  // Fall through for unknown types
  return {}
}

/**
 * Convert an AgentTool to the provider-level ToolSchema format.
 */
export function toolToSchema(tool: AgentTool): ToolSchema {
  const jsonSchema = zodToJsonSchema(tool.inputSchema)

  // The provider expects the inputSchema to be an object schema
  const inputSchema = jsonSchema as {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }

  return {
    name: tool.name,
    description: tool.description,
    inputSchema,
  }
}
