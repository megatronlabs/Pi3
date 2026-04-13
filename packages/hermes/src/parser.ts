import type { HermesToolCall, HermesParseResult } from './types.js'

const TOOL_CALL_RE = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g
const OPEN_TAG_RE = /<tool_call>/
const CLOSE_TAG_RE = /<\/tool_call>/

/**
 * Attempts to repair common JSON formatting issues produced by LLMs.
 *
 * Repairs applied (in order):
 * 1. Replace smart/curly quotes with straight quotes.
 * 2. Replace single-quoted string delimiters with double quotes.
 * 3. Strip trailing commas before closing braces or brackets.
 * 4. Remove JavaScript-style line and block comments.
 *
 * @param raw - The raw JSON-ish string from the model.
 * @returns A string that is more likely to parse as valid JSON.
 */
function repairJson(raw: string): string {
  let s = raw

  // Replace curly/smart quotes with straight equivalents
  s = s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')

  // Remove single-line // comments (outside of strings is best-effort)
  s = s.replace(/\/\/[^\n]*/g, '')

  // Remove block comments
  s = s.replace(/\/\*[\s\S]*?\*\//g, '')

  // Replace single-quoted keys/values with double quotes (heuristic)
  s = s.replace(/'([^'\\]*(\\.[^'\\]*)*)'/g, '"$1"')

  // Strip trailing commas before closing braces/brackets
  s = s.replace(/,(\s*[}\]])/g, '$1')

  return s
}

/**
 * Parses the JSON content of a single tool_call block.
 * Returns null if parsing fails even after repair attempts.
 */
function parseToolCallJson(raw: string): HermesToolCall | null {
  const attempts = [raw, repairJson(raw)]

  for (const attempt of attempts) {
    try {
      const parsed: unknown = JSON.parse(attempt)
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        'name' in parsed &&
        typeof (parsed as Record<string, unknown>).name === 'string'
      ) {
        const obj = parsed as Record<string, unknown>
        const args =
          obj.arguments !== null &&
          typeof obj.arguments === 'object' &&
          !Array.isArray(obj.arguments)
            ? (obj.arguments as Record<string, unknown>)
            : {}
        return { name: obj.name as string, arguments: args }
      }
    } catch (_err) {
      // continue to next attempt
    }
  }

  return null
}

/**
 * Fallback: find bare JSON objects with {name, arguments} when no XML tags present.
 * Handles models that drop the <tool_call> wrapper entirely.
 */
function parseBareJsonToolCalls(text: string): HermesParseResult {
  const toolCalls: HermesToolCall[] = []
  // Match JSON objects that start with "name" key (tool call pattern)
  const BARE_JSON_RE = /\{[\s\S]*?"name"\s*:\s*"([^"]+)"[\s\S]*?\}/g
  let match: RegExpExecArray | null
  let firstMatchStart = -1
  let lastMatchEnd = -1

  BARE_JSON_RE.lastIndex = 0
  while ((match = BARE_JSON_RE.exec(text)) !== null) {
    const parsed = parseToolCallJson(match[0])
    if (parsed !== null) {
      if (firstMatchStart === -1) firstMatchStart = match.index
      lastMatchEnd = match.index + match[0].length
      toolCalls.push(parsed)
    }
  }

  if (toolCalls.length === 0) return { toolCalls: [], textBefore: text, textAfter: '' }
  return {
    toolCalls,
    textBefore: text.slice(0, firstMatchStart),
    textAfter: text.slice(lastMatchEnd),
  }
}

/**
 * Parses a raw model response string for Hermes-format tool calls.
 *
 * Extracts every complete tool_call block, parses the JSON inside each block,
 * and returns a structured result. Malformed JSON is repaired heuristically;
 * blocks that cannot be parsed are silently skipped.
 *
 * Incomplete (streaming) tool calls where the opening tag exists but the
 * closing tag is absent are ignored and do not appear in toolCalls.
 *
 * @param text - Raw text output from the model.
 * @returns A HermesParseResult with parsed tool calls and surrounding text.
 *
 * @example
 * ```ts
 * const result = parseHermesResponse(modelOutput)
 * for (const call of result.toolCalls) {
 *   console.log(call.name, call.arguments)
 * }
 * ```
 */
export function parseHermesResponse(text: string): HermesParseResult {
  const toolCalls: HermesToolCall[] = []

  // Detect partial/streaming tool call: opening tag without closing tag
  const hasOpen = OPEN_TAG_RE.test(text)
  const hasClose = CLOSE_TAG_RE.test(text)
  if (hasOpen && !hasClose) {
    // Incomplete -- treat as plain text, no tool calls
    return { toolCalls: [], textBefore: text, textAfter: '' }
  }

  // Find first and last tool_call positions for textBefore / textAfter
  let firstMatchStart = -1
  let lastMatchEnd = -1

  TOOL_CALL_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TOOL_CALL_RE.exec(text)) !== null) {
    if (firstMatchStart === -1) {
      firstMatchStart = match.index
    }
    lastMatchEnd = match.index + match[0].length

    const innerContent = match[1]
    const parsed = parseToolCallJson(innerContent)
    if (parsed !== null) {
      toolCalls.push(parsed)
    }
  }

  if (firstMatchStart === -1) {
    // No <tool_call> tags found — try fallback: bare JSON with name+arguments fields
    // Some models emit {"name":"foo","arguments":{...}} without XML wrapping
    const fallback = parseBareJsonToolCalls(text)
    if (fallback.toolCalls.length > 0) return fallback
    return { toolCalls: [], textBefore: text, textAfter: '' }
  }

  const textBefore = text.slice(0, firstMatchStart)
  const textAfter = text.slice(lastMatchEnd)

  return { toolCalls, textBefore, textAfter }
}

/**
 * Returns true if the text contains an incomplete (streaming) tool call,
 * i.e. an opening tool_call tag without a corresponding closing tag.
 *
 * Use this during streaming to decide whether to wait for more tokens before
 * parsing.
 *
 * @param text - Partial model output accumulated so far.
 */
export function isPartialToolCall(text: string): boolean {
  const hasOpen = OPEN_TAG_RE.test(text)
  const hasClose = CLOSE_TAG_RE.test(text)
  return hasOpen && !hasClose
}
