// Command-line parsing shared by the `buckyos` CLI (`cli/core/argv.ts`,
// `cli/core/command.ts`) and the xllm site tools' `exec`. Self-contained on
// purpose: the CLI imports it by relative path. Errors carry the CLI's usage
// codes; the CLI turns them into its `UsageError`.

export type JsonSchema = {
  type?: 'object' | 'array' | 'string' | 'boolean' | 'integer' | 'number' | 'null'
  title?: string
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  additionalProperties?: boolean
  items?: JsonSchema
  enum?: unknown[]
  minLength?: number
  minimum?: number
  default?: unknown
  secret?: boolean
}

export interface PositionalDefinition {
  name: string
  description: string
  required?: boolean
}

export interface OptionDefinition {
  name: string
  property?: string
  description: string
  type: 'string' | 'boolean' | 'integer' | 'number'
  required?: boolean
  secret?: boolean
  enum?: string[]
}

export type AccessLevel = 'read' | 'write' | 'destructive' | 'privileged'

/** A usage error with the CLI's code (`UNKNOWN_OPTION`, `SCHEMA_VALIDATION_FAILED`, …). */
export class CommandArgsError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'CommandArgsError'
    this.code = code
  }
}

function hasOwn(o: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, key)
}

export function optionProperty(option: OptionDefinition): string {
  return option.property ?? option.name.split('-').join('_')
}

export interface LongOption {
  name: string
  inlineValue?: string
}

export function splitLongOption(token: string): LongOption {
  const content = token.slice(2)
  const equalIndex = content.indexOf('=')
  return equalIndex < 0 ? { name: content } : { name: content.slice(0, equalIndex), inlineValue: content.slice(equalIndex + 1) }
}

export function readOptionValue(argv: string[], index: number, option: LongOption): { value: string; consumed: number } {
  if (option.inlineValue !== undefined) {
    if (!option.inlineValue) throw new CommandArgsError('MISSING_ARGUMENT', `--${option.name} requires a value`)
    return { value: option.inlineValue, consumed: 1 }
  }
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) throw new CommandArgsError('MISSING_ARGUMENT', `--${option.name} requires a value`)
  return { value, consumed: 2 }
}

function parseOptionValue(type: string, value: string, name: string): unknown {
  if (type === 'string') return value
  const number = Number(value)
  if (!Number.isFinite(number) || (type === 'integer' && !Number.isInteger(number))) {
    throw new CommandArgsError('INVALID_ARGUMENT', `--${name} requires a ${type}`)
  }
  return number
}

function assignPositional(input: Record<string, unknown>, positionals: PositionalDefinition[], index: number, value: string): number {
  const positional = positionals[index]
  if (!positional) throw new CommandArgsError('TOO_MANY_ARGUMENTS', `unexpected positional argument: ${value}`)
  input[positional.name] = value
  return index + 1
}

export interface ArgvSpec {
  positionals?: PositionalDefinition[]
  options?: OptionDefinition[]
}

/**
 * Looks at every long option before the command's own: the CLI handles its
 * interactive session options here. Return how many tokens it consumed, or
 * `undefined` to leave the option to the command.
 */
export type LongOptionHook = (option: LongOption, argv: string[], index: number) => number | undefined

/** Positionals, `--opt value` / `--opt=value`, boolean options, `--`; `--help` / `-h` sets `help`. */
export function parseArgv(spec: ArgvSpec, argv: string[], beforeOption?: LongOptionHook): {
  input: Record<string, unknown>
  help: boolean
  positionalCount: number
} {
  const input: Record<string, unknown> = {}
  const positionals = spec.positionals ?? []
  const optionByName = new Map((spec.options ?? []).map(o => [o.name, o]))
  let positionalIndex = 0
  let help = false
  for (let index = 0; index < argv.length;) {
    const token = argv[index]
    if (token === '--help' || token === '-h') {
      help = true
      index += 1
      continue
    }
    if (token === '--') {
      for (const value of argv.slice(index + 1)) positionalIndex = assignPositional(input, positionals, positionalIndex, value)
      break
    }
    if (!token.startsWith('--')) {
      positionalIndex = assignPositional(input, positionals, positionalIndex, token)
      index += 1
      continue
    }
    const parsed = splitLongOption(token)
    const handled = beforeOption?.(parsed, argv, index)
    if (handled !== undefined) {
      index += handled
      continue
    }
    const option = optionByName.get(parsed.name)
    if (!option) throw new CommandArgsError('UNKNOWN_OPTION', `unknown option: --${parsed.name}`)
    const property = optionProperty(option)
    if (hasOwn(input, property)) throw new CommandArgsError('DUPLICATE_ARGUMENT', `argument provided more than once: ${property}`)
    if (option.type === 'boolean') {
      if (parsed.inlineValue !== undefined) throw new CommandArgsError('INVALID_ARGUMENT', `--${parsed.name} does not accept a value`)
      input[property] = true
      index += 1
      continue
    }
    const { value, consumed } = readOptionValue(argv, index, parsed)
    input[property] = parseOptionValue(option.type, value, parsed.name)
    index += consumed
  }
  return { input, help, positionalCount: positionalIndex }
}

/** Required positionals after `positionalCount` must be in `inputObject`. */
export function checkRequiredPositionals(positionals: PositionalDefinition[], positionalCount: number, inputObject: Record<string, unknown> | undefined) {
  for (let index = positionalCount; index < positionals.length; index++) {
    if (positionals[index].required !== false && !hasOwn(inputObject ?? {}, positionals[index].name)) {
      throw new CommandArgsError('MISSING_ARGUMENT', `missing positional argument: ${positionals[index].name}`)
    }
  }
}

export function mergeCommandInput(inputObject: Record<string, unknown> | undefined, cliInput: Record<string, unknown>): Record<string, unknown> {
  const result = { ...(inputObject ?? {}) }
  for (const [key, value] of Object.entries(cliInput)) {
    if (hasOwn(result, key)) throw new CommandArgsError('ARGUMENT_CONFLICT', `${key} is present in both --input and argv`)
    result[key] = value
  }
  return result
}

/** Split a command line into words: single and double quotes, backslash escapes (not inside single quotes). */
export function parseShellLine(line: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: 'single' | 'double' | null = null
  let escaped = false
  let started = false
  for (const character of line) {
    if (escaped) {
      current += character
      escaped = false
      started = true
      continue
    }
    if (character === '\\' && quote !== 'single') {
      escaped = true
      started = true
      continue
    }
    if (quote === 'single') {
      if (character === "'") quote = null
      else current += character
      continue
    }
    if (quote === 'double') {
      if (character === '"') quote = null
      else current += character
      continue
    }
    if (character === "'") {
      quote = 'single'
      started = true
      continue
    }
    if (character === '"') {
      quote = 'double'
      started = true
      continue
    }
    if (/\s/.test(character)) {
      if (started) {
        tokens.push(current)
        current = ''
        started = false
      }
      continue
    }
    current += character
    started = true
  }
  if (escaped) throw new CommandArgsError('INVALID_COMMAND_LINE', 'unfinished escape sequence')
  if (quote) throw new CommandArgsError('INVALID_COMMAND_LINE', `unterminated ${quote} quote`)
  if (started) tokens.push(current)
  return tokens
}

export function validateSchema(value: unknown, schema: JsonSchema, path: string): void {
  if (schema.enum && !schema.enum.some(candidate => Object.is(candidate, value))) {
    throw new CommandArgsError('SCHEMA_VALIDATION_FAILED', `${path} must be one of ${schema.enum.join(', ')}`)
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CommandArgsError('SCHEMA_VALIDATION_FAILED', `${path} must be an object`)
    const object = value as Record<string, unknown>
    for (const required of schema.required ?? []) {
      if (!hasOwn(object, required)) throw new CommandArgsError('SCHEMA_VALIDATION_FAILED', `${path}.${required} is required`)
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(object)) {
        if (!hasOwn(schema.properties ?? {}, key)) throw new CommandArgsError('SCHEMA_VALIDATION_FAILED', `${path}.${key} is not allowed`)
      }
    }
    for (const [key, propertyValue] of Object.entries(object)) {
      const propertySchema = schema.properties?.[key]
      if (propertySchema) validateSchema(propertyValue, propertySchema, `${path}.${key}`)
    }
    return
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) throw new CommandArgsError('SCHEMA_VALIDATION_FAILED', `${path} must be an array`)
    const items = schema.items
    if (items) value.forEach((item, index) => validateSchema(item, items, `${path}[${index}]`))
    return
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') throw new CommandArgsError('SCHEMA_VALIDATION_FAILED', `${path} must be a string`)
    if (schema.minLength !== undefined && value.length < schema.minLength) throw new CommandArgsError('SCHEMA_VALIDATION_FAILED', `${path} is too short`)
    return
  }
  if (schema.type === 'boolean' && typeof value !== 'boolean') throw new CommandArgsError('SCHEMA_VALIDATION_FAILED', `${path} must be a boolean`)
  if (schema.type === 'integer' && (!Number.isInteger(value) || typeof value !== 'number')) {
    throw new CommandArgsError('SCHEMA_VALIDATION_FAILED', `${path} must be an integer`)
  }
  if (schema.type === 'number' && typeof value !== 'number') throw new CommandArgsError('SCHEMA_VALIDATION_FAILED', `${path} must be a number`)
}
