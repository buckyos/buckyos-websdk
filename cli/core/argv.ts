import type { JsonSchema, RegisteredCommand } from './command.ts'
import { UsageError } from './errors.ts'
import {
  checkRequiredPositionals,
  CommandArgsError,
  type LongOption,
  mergeCommandInput,
  parseArgv,
  parseShellLine as parseShellLineCore,
  readOptionValue as readOptionValueCore,
  splitLongOption,
  validateSchema as validateSchemaCore,
} from '../../src/internal/command_args.ts'

export const OUTPUT_FORMATS = ['json', 'jsonl', 'table', 'text', 'raw'] as const
export type OutputFormat = typeof OUTPUT_FORMATS[number]

export interface GlobalOptions {
  configDir?: string
  allowRead?: string[]
  profile?: string
  zone?: string
  endpoint?: string
  identity?: string
  sessionToken?: string
  sessionTokenFile?: string
  cli?: boolean
  output?: OutputFormat
  input?: string
  timeout?: string
  traceId?: string
  idempotencyKey?: string
  wait?: boolean
  nonInteractive?: boolean
  yes?: boolean
  noColor?: boolean
  verbose?: boolean
  help?: boolean
  version?: boolean
}

export interface Invocation {
  global: GlobalOptions
  module?: string
  verb?: string
  actionArgv: string[]
}

export interface ParsedCommandArgs {
  input: Record<string, unknown>
  scoped: GlobalOptions
  help: boolean
}

const STRING_GLOBALS = new Map<string, keyof GlobalOptions>([
  ['config-dir', 'configDir'],
  ['profile', 'profile'],
  ['zone', 'zone'],
  ['endpoint', 'endpoint'],
  ['identity', 'identity'],
  ['session-token', 'sessionToken'],
  ['session-token-file', 'sessionTokenFile'],
  ['output', 'output'],
  ['input', 'input'],
  ['timeout', 'timeout'],
  ['trace-id', 'traceId'],
  ['idempotency-key', 'idempotencyKey'],
])

const REPEATABLE_STRING_GLOBALS = new Map<string, keyof GlobalOptions>([
  ['allow-read', 'allowRead'],
])

const BOOLEAN_GLOBALS = new Map<string, keyof GlobalOptions>([
  ['cli', 'cli'],
  ['wait', 'wait'],
  ['non-interactive', 'nonInteractive'],
  ['yes', 'yes'],
  ['no-color', 'noColor'],
  ['verbose', 'verbose'],
  ['help', 'help'],
  ['version', 'version'],
])

const REPL_SCOPED_STRING_GLOBALS = new Set([
  'input',
  'timeout',
  'trace-id',
  'idempotency-key',
  'output',
])
const REPL_SCOPED_BOOLEAN_GLOBALS = new Set(['wait', 'yes'])

export function parseInvocation(argv: string[]): Invocation {
  const global: GlobalOptions = {}
  let index = 0
  while (index < argv.length) {
    const token = argv[index]
    if (token === '-h') {
      setGlobal(global, 'help', true)
      index += 1
      continue
    }
    if (token === '--') {
      index += 1
      break
    }
    if (!token.startsWith('--')) break
    const parsed = splitLongOption(token)
    const booleanProperty = BOOLEAN_GLOBALS.get(parsed.name)
    if (booleanProperty) {
      if (parsed.inlineValue !== undefined) {
        throw new UsageError('INVALID_ARGUMENT', `--${parsed.name} does not accept a value`)
      }
      setGlobal(global, booleanProperty, true)
      index += 1
      continue
    }
    const stringProperty = STRING_GLOBALS.get(parsed.name)
    const repeatableStringProperty = REPEATABLE_STRING_GLOBALS.get(parsed.name)
    if (!stringProperty && !repeatableStringProperty) {
      throw new UsageError('UNKNOWN_OPTION', `unknown global option: --${parsed.name}`)
    }
    const { value, consumed } = readOptionValue(argv, index, parsed)
    if (repeatableStringProperty === 'allowRead') {
      global.allowRead = [...(global.allowRead ?? []), value]
    } else {
      setGlobal(global, stringProperty!, normalizeGlobalValue(parsed.name, value))
    }
    index += consumed
  }

  const module = argv[index]
  const verb = argv[index + 1]
  const actionArgv = module ? argv.slice(index + (verb ? 2 : 1)) : []
  if (module?.startsWith('-')) {
    throw new UsageError(
      'INVALID_ARGUMENT',
      `global options must appear before the module: ${module}`,
    )
  }
  return { global, module, verb, actionArgv }
}

export function parseCommandArgs(
  command: RegisteredCommand,
  argv: string[],
  inputObject: Record<string, unknown> | undefined,
  allowReplScopedGlobals = false,
  deferValidation = false,
): ParsedCommandArgs {
  const scoped: GlobalOptions = {}
  const replScoped = (parsed: LongOption, args: string[], index: number): number | undefined => {
    if (!allowReplScopedGlobals) return undefined
    if (REPL_SCOPED_BOOLEAN_GLOBALS.has(parsed.name)) {
      if (parsed.inlineValue !== undefined) {
        throw new UsageError('INVALID_ARGUMENT', `--${parsed.name} does not accept a value`)
      }
      setGlobal(scoped, BOOLEAN_GLOBALS.get(parsed.name)!, true)
      return 1
    }
    if (REPL_SCOPED_STRING_GLOBALS.has(parsed.name)) {
      const property = STRING_GLOBALS.get(parsed.name)!
      const { value, consumed } = readOptionValue(args, index, parsed)
      setGlobal(scoped, property, normalizeGlobalValue(parsed.name, value))
      return consumed
    }
    if (
      STRING_GLOBALS.has(parsed.name) || REPEATABLE_STRING_GLOBALS.has(parsed.name) ||
      BOOLEAN_GLOBALS.has(parsed.name)
    ) {
      throw new UsageError(
        'SESSION_OPTION_FROZEN',
        `--${parsed.name} is frozen for the interactive session`,
      )
    }
    return undefined
  }
  return usage(() => {
    const parsed = parseArgv(command, argv, replScoped)
    if (!deferValidation) {
      checkRequiredPositionals(command.positionals ?? [], parsed.positionalCount, inputObject)
    }
    const input = mergeCommandInput(inputObject, parsed.input)
    if (!deferValidation) validateSchemaCore(input, command.inputSchema, 'input')
    return { input, scoped, help: parsed.help }
  })
}

export function parseDuration(value: string): number {
  const match = /^(\d+)(ms|s|m|h)$/.exec(value.trim())
  if (!match) {
    throw new UsageError('INVALID_DURATION', `invalid duration: ${value}`)
  }
  const amount = Number(match[1])
  const scale = match[2] === 'ms'
    ? 1
    : match[2] === 's'
    ? 1_000
    : match[2] === 'm'
    ? 60_000
    : 3_600_000
  const result = amount * scale
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new UsageError('INVALID_DURATION', `invalid duration: ${value}`)
  }
  return result
}

export function parseShellLine(line: string): string[] {
  return usage(() => parseShellLineCore(line))
}

export function validateSchema(value: unknown, schema: JsonSchema, path: string): void {
  usage(() => validateSchemaCore(value, schema, path))
}

/** Usage errors of the shared parser become the CLI's `UsageError` (same code and message). */
function usage<T>(f: () => T): T {
  try {
    return f()
  } catch (error) {
    if (error instanceof CommandArgsError) throw new UsageError(error.code, error.message)
    throw error
  }
}

function readOptionValue(
  argv: string[],
  index: number,
  option: LongOption,
): { value: string; consumed: number } {
  return usage(() => readOptionValueCore(argv, index, option))
}






function normalizeGlobalValue(name: string, value: string): string | OutputFormat {
  if (name === 'output') {
    if (!OUTPUT_FORMATS.includes(value as OutputFormat)) {
      throw new UsageError('INVALID_OUTPUT_FORMAT', `invalid output format: ${value}`)
    }
    return value as OutputFormat
  }
  return value
}

function setGlobal<K extends keyof GlobalOptions>(
  target: GlobalOptions,
  property: K,
  value: GlobalOptions[K],
): void {
  if (target[property] !== undefined) {
    throw new UsageError('DUPLICATE_ARGUMENT', `option provided more than once: ${property}`)
  }
  target[property] = value
}
