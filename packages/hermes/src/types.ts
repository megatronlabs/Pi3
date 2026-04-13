/**
 * Core type definitions for the Hermes tool-calling format.
 *
 * The Hermes format enables tool use in open-weight LLMs that lack native
 * function-calling APIs by injecting tool definitions into the system prompt
 * and parsing structured XML tags from the model's raw text output.
 */

/** A parameter definition within a Hermes tool schema. */
export interface HermesParam {
  /** JSON Schema primitive or compound type. */
  type: string
  /** Human-readable description surfaced to the model. */
  description?: string
  /** Allowable values for string enum parameters. */
  enum?: string[]
  /** Schema for array item elements (when type is 'array'). */
  items?: HermesParam
  /** Nested property schemas (when type is 'object'). */
  properties?: Record<string, HermesParam>
  /** Required property names (when type is 'object'). */
  required?: string[]
}

/** A complete tool definition in the Hermes format. */
export interface HermesTool {
  /** Unique identifier used by the model when calling the tool. */
  name: string
  /** Description of what the tool does, shown to the model. */
  description: string
  /** JSON Schema–style parameter object. */
  parameters: {
    type: 'object'
    properties: Record<string, HermesParam>
    required?: string[]
  }
}

/** A single parsed tool call extracted from model output. */
export interface HermesToolCall {
  /** Name of the tool being invoked. */
  name: string
  /** Parsed argument map passed to the tool. */
  arguments: Record<string, unknown>
}

/**
 * The full result of parsing a model's raw text response for tool calls.
 * All three fields are always present; toolCalls may be an empty array.
 */
export interface HermesParseResult {
  /** All tool calls found in the response, in order. */
  toolCalls: HermesToolCall[]
  /** Raw text content appearing before the first <tool_call> tag. */
  textBefore: string
  /** Raw text content appearing after the last </tool_call> tag. */
  textAfter: string
}
