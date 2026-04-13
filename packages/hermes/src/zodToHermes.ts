import { z } from 'zod'
import type { HermesTool, HermesParam } from './types.js'

// ---------------------------------------------------------------------------
// Zod internal type discriminants — these match the ZodFirstPartyTypeKind enum
// used by zod@3.x. We use string literals so there is no runtime import needed.
// ---------------------------------------------------------------------------

type ZodDef = z.ZodTypeAny['_def']

/** Extracts the description from a Zod schema's `_def`, if any. */
function getDescription(schema: z.ZodTypeAny): string | undefined {
  const def = schema._def as { description?: string }
  return def.description
}

/**
 * Recursively converts a Zod schema to a `HermesParam`.
 *
 * Supported Zod types:
 * - `z.string()` → `{ type: 'string' }`
 * - `z.number()` → `{ type: 'number' }`
 * - `z.boolean()` → `{ type: 'boolean' }`
 * - `z.array(T)` → `{ type: 'array', items: convert(T) }`
 * - `z.object({...})` → `{ type: 'object', properties: {...}, required: [...] }`
 * - `z.enum([...])` → `{ type: 'string', enum: [...] }`
 * - `z.optional(T)` / `T.optional()` → unwraps and marks as not required
 * - Unrecognised types fall back to `{ type: 'string' }`.
 *
 * @param schema - Any Zod schema.
 * @returns A `HermesParam` describing the schema.
 */
export function zodToHermesParam(schema: z.ZodTypeAny): HermesParam {
  const def = schema._def as ZodDef & { typeName: string }
  const description = getDescription(schema)

  const base: HermesParam = description ? { type: 'string', description } : { type: 'string' }

  switch (def.typeName) {
    case 'ZodString':
      return { ...base, type: 'string' }

    case 'ZodNumber':
    case 'ZodBigInt':
      return { ...base, type: 'number' }

    case 'ZodBoolean':
      return { ...base, type: 'boolean' }

    case 'ZodArray': {
      const arrayDef = def as { typeName: string; type: z.ZodTypeAny }
      const itemParam = zodToHermesParam(arrayDef.type)
      const param: HermesParam = { ...base, type: 'array', items: itemParam }
      return param
    }

    case 'ZodObject': {
      const objectDef = def as {
        typeName: string
        shape: () => Record<string, z.ZodTypeAny>
      }
      const shape = objectDef.shape()
      const properties: Record<string, HermesParam> = {}
      const required: string[] = []

      for (const [key, fieldSchema] of Object.entries(shape)) {
        const fieldDef = (fieldSchema as z.ZodTypeAny)._def as { typeName: string }
        const isOptional =
          fieldDef.typeName === 'ZodOptional' || fieldDef.typeName === 'ZodDefault'

        properties[key] = zodToHermesParam(fieldSchema as z.ZodTypeAny)
        if (!isOptional) {
          required.push(key)
        }
      }

      const param: HermesParam = { ...base, type: 'object', properties }
      if (required.length > 0) {
        param.required = required
      }
      return param
    }

    case 'ZodEnum': {
      const enumDef = def as { typeName: string; values: string[] }
      return { ...base, type: 'string', enum: enumDef.values }
    }

    case 'ZodNativeEnum': {
      // Extract values from native TS enum objects
      const nativeDef = def as { typeName: string; values: Record<string, string | number> }
      const enumValues = Object.values(nativeDef.values)
        .filter((v): v is string => typeof v === 'string')
      return { ...base, type: 'string', enum: enumValues }
    }

    case 'ZodOptional':
    case 'ZodNullable': {
      const wrappedDef = def as { typeName: string; innerType: z.ZodTypeAny }
      const inner = zodToHermesParam(wrappedDef.innerType)
      // Preserve description from the optional wrapper if the inner has none
      if (description && !inner.description) {
        inner.description = description
      }
      return inner
    }

    case 'ZodDefault': {
      const defaultDef = def as { typeName: string; innerType: z.ZodTypeAny }
      const inner = zodToHermesParam(defaultDef.innerType)
      if (description && !inner.description) {
        inner.description = description
      }
      return inner
    }

    case 'ZodLiteral': {
      const literalDef = def as { typeName: string; value: unknown }
      if (typeof literalDef.value === 'string') {
        return { ...base, type: 'string', enum: [literalDef.value] }
      }
      if (typeof literalDef.value === 'number') {
        return { ...base, type: 'number' }
      }
      if (typeof literalDef.value === 'boolean') {
        return { ...base, type: 'boolean' }
      }
      return base
    }

    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      // Best-effort: use the type of the first option
      const unionDef = def as { typeName: string; options: z.ZodTypeAny[] }
      if (unionDef.options.length > 0) {
        const inner = zodToHermesParam(unionDef.options[0])
        if (description && !inner.description) {
          inner.description = description
        }
        return inner
      }
      return base
    }

    case 'ZodAny':
    case 'ZodUnknown':
      return { ...base, type: 'object' }

    default:
      return base
  }
}

/**
 * Converts a named Zod object schema into a `HermesTool` ready for serialization.
 *
 * The `name` and `description` fields are provided explicitly because Zod
 * schemas don't carry a tool name — only parameter-level descriptions.
 *
 * @param name - The tool identifier the model will use in `<tool_call>` blocks.
 * @param description - Human-readable summary of the tool's purpose.
 * @param schema - A `z.object(...)` schema describing the tool's parameters.
 * @returns A `HermesTool` ready to pass to `buildHermesSystemPrompt`.
 *
 * @example
 * ```ts
 * const schema = z.object({
 *   query: z.string().describe('Search query'),
 *   limit: z.number().optional().describe('Max results'),
 * })
 * const tool = zodSchemaToHermesTool('search', 'Search the web', schema)
 * ```
 */
export function zodSchemaToHermesTool(
  name: string,
  description: string,
  schema: z.ZodObject<z.ZodRawShape>
): HermesTool {
  const shape = schema.shape
  const properties: Record<string, HermesParam> = {}
  const required: string[] = []

  for (const [key, fieldSchema] of Object.entries(shape)) {
    const field = fieldSchema as z.ZodTypeAny
    const fieldDef = field._def as { typeName: string }
    const isOptional =
      fieldDef.typeName === 'ZodOptional' || fieldDef.typeName === 'ZodDefault'

    properties[key] = zodToHermesParam(field)
    if (!isOptional) {
      required.push(key)
    }
  }

  const tool: HermesTool = {
    name,
    description,
    parameters: {
      type: 'object',
      properties,
    },
  }

  if (required.length > 0) {
    tool.parameters.required = required
  }

  return tool
}
