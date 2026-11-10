// The checks of a skill package before it reaches an Agent: a port of `package_skills`, `commands_in_manual` and the
// content rules of `plan()` in buckyos `src/frame/lib_opendan/src/skills.rs`, with the front matter rules of
// `protocol/behavior.rs`. The Agent runs the Rust ones again at install; keep the two in step.
import { getHost } from '../runtime/host.ts'
import { sha256Bytes } from './pikg_archive.ts'
import { EXT_TOOLS_RESERVED_COMMANDS } from './pikg_protocol.ts'

export const SKILL_KINDS = ['work', 'plan', 'goal'] as const
export type SkillKind = (typeof SKILL_KINDS)[number]
export const SKILL_KIND_DIRS: Record<SkillKind, string> = {
  work: 'cmd_skills',
  plan: 'plan_skills',
  goal: 'goal_skills',
}
export const TOOLS_DIR = 'tools'
export const SKILL_DIRS = [...SKILL_KINDS.map((kind) => SKILL_KIND_DIRS[kind]), TOOLS_DIR]
export const SKILL_MANUAL = 'SKILL.md'
export const SKILL_REFERENCES = 'references'
export const SKILL_REVISIONS = 'revisions'
export const SKILL_PLATFORMS = ['linux', 'macos', 'windows']
export const UI_MANUAL_WARN_BYTES = 16 * 1024
export const PLAN_MANUAL_WARN_BYTES = 3 * 1024
const MAX_NAME_LEN = 200

/** Commands of the standard layer (Rust: `STANDARD_TOOLS` in buckyos `src/frame/lib_opendan/src/baseline.rs`): a manual
 * does not declare them. */
export const STANDARD_COMMANDS: readonly string[] = EXT_TOOLS_RESERVED_COMMANDS

export interface SkillFinding {
  code: string
  /** `error` (not installable) | `high` | `medium` | `low`. */
  level: string
  where: string
  note: string
}

export interface SkillPackageFile {
  bytes: Uint8Array
}

export type SkillScope = 'work' | 'ui' | 'ui,work'

export interface LintedSkill {
  kind: SkillKind
  name: string
  scope: SkillScope
  description: string
  requires: string
  baseline: 'standard' | 'extended'
  platforms: string[]
  commands: string[]
  size: number
  references: string[]
}

export interface SkillLintResult {
  skills: LintedSkill[]
  findings: SkillFinding[]
}

// Words at a command position that are the shell's own or part of every runtime.
const SHELL_WORDS = new Set([
  'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac', 'in', 'function', 'select', 'time',
  'cd', 'echo', 'printf', 'export', 'set', 'unset', 'read', 'exit', 'return', 'source', 'eval', 'exec', 'test', 'true', 'false', 'local',
  'declare', 'trap', 'wait', 'shift', 'alias', 'type', 'command', 'pwd', 'kill', 'umask', 'ulimit', 'break', 'continue', 'let', 'readonly',
  'ls', 'cat', 'cp', 'mv', 'rm', 'mkdir', 'rmdir', 'touch', 'ln', 'chmod', 'chown', 'head', 'tail', 'grep', 'sed', 'awk', 'sort', 'uniq',
  'wc', 'cut', 'tr', 'tee', 'find', 'xargs', 'basename', 'dirname', 'date', 'sleep', 'env', 'which', 'diff', 'du', 'df', 'stat', 'mktemp',
  'sh', 'bash', 'id', 'whoami', 'uname', 'realpath', 'readlink', 'seq', 'yes', 'nohup', 'timeout', 'tar', 'gzip', 'gunzip', 'sha256sum',
  'base64', 'cmp', 'file', 'ps', 'less', 'more', 'printenv', 'hostname', 'expr', 'od', 'paste', 'comm', 'nl', 'tac', 'rev', 'fold', 'column',
  'read', 'shell',
])
const SHELL_LANGS = new Set(['', 'sh', 'bash', 'shell', 'zsh', 'console'])
const ASSIGNMENT_KEY = /^[A-Za-z0-9_]+$/
const PLAIN_WORD = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/

function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (c) => c.toLowerCase())
}

/** The commands the shell code blocks of a manual run: the first word of each command, the shell's own words and
 * placeholders left out. A heuristic for telling the owner what a manual relies on, never a gate. */
export function commandsInManual(text: string): Set<string> {
  const out = new Set<string>()
  let inBlock = false
  let shell = false
  let heredoc: string | undefined
  let continued = false
  for (const raw of text.split('\n')) {
    let line = raw.trim()
    if (line.startsWith('```')) {
      inBlock = !inBlock
      shell = inBlock && SHELL_LANGS.has(asciiLower(line.slice(3).trim()))
      heredoc = undefined
      continued = false
      continue
    }
    if (!inBlock || !shell) continue
    if (heredoc !== undefined) {
      if (line === heredoc) heredoc = undefined
      continue
    }
    const wasContinued = continued
    continued = line.endsWith('\\')
    const at = line.indexOf('<<')
    if (at >= 0) {
      const tag = line.slice(at + 2).replace(/^-+/, '').trim().split(/\s/)[0].replace(/^['"]+|['"]+$/g, '')
      if (tag && /^[A-Za-z0-9_]+$/.test(tag)) heredoc = tag
    }
    if (wasContinued || !line || line.startsWith('#')) continue
    if (line.startsWith('$ ')) line = line.slice(2)
    let quote: string | undefined
    const segments = ['']
    const chars = Array.from(line)
    for (let i = 0; i < chars.length; i += 1) {
      const c = chars[i]
      if (quote !== undefined) {
        if (c === quote) quote = undefined
      } else if (c === "'" || c === '"') {
        quote = c
      } else if (c === '#' && (i === 0 || /\s/.test(chars[i - 1]))) {
        break
      } else if (
        // `a|b|c` without spaces is a list of alternatives in a usage line, not a pipe (as in skills.rs).
        (c === '|' && (chars[i + 1] === undefined || /\s/.test(chars[i + 1]) || chars[i + 1] === '|' || (i > 0 && /\s/.test(chars[i - 1])))) ||
        c === ';' || (c === '&' && chars[i + 1] === '&')
      ) {
        if (chars[i + 1] === c) i += 1
        segments.push('')
        continue
      } else if (c === '$' && chars[i + 1] === '(') {
        segments.push('')
        i += 1
        continue
      }
      segments[segments.length - 1] += c
    }
    for (const segment of segments) {
      const first = segment.split(/\s+/).filter(Boolean).find((w) => {
        const eq = w.indexOf('=')
        if (eq >= 0 && ASSIGNMENT_KEY.test(w.slice(0, eq))) return false
        return w !== 'sudo' && w !== '(' && w !== '{' && w !== '!'
      })
      if (first === undefined) continue
      const word = first.replace(/^\(+/, '')
      if (PLAIN_WORD.test(word) && /[a-z]/.test(word) && !SHELL_WORDS.has(word)) out.add(word)
    }
  }
  return out
}

/** A manual split into its front matter (`---` lines around `key: value` lines) and its body; without front matter it
 * is all body. */
export function splitFrontMatter(text: string): { fields: Map<string, string>; body: string } {
  const trimmed = text.replace(/^﻿+/, '')
  const rest = trimmed.startsWith('---\n')
    ? trimmed.slice(4)
    : trimmed.startsWith('---\r\n')
    ? trimmed.slice(5)
    : undefined
  if (rest === undefined) return { fields: new Map(), body: text.trim() }
  const fields = new Map<string, string>()
  let offset = 0
  while (offset < rest.length) {
    const end = rest.indexOf('\n', offset)
    const next = end < 0 ? rest.length : end + 1
    const line = rest.slice(offset, next).trim()
    offset = next
    if (line === '---') return { fields, body: rest.slice(offset).trim() }
    const colon = line.indexOf(':')
    if (colon < 0) continue
    let value = line.slice(colon + 1).trim()
    for (const q of ['"', "'"]) {
      if (value.length >= 2 && value.startsWith(q) && value.endsWith(q)) {
        value = value.slice(1, -1)
        break
      }
    }
    fields.set(line.slice(0, colon).trim(), value)
  }
  // No closing line: not front matter.
  return { fields: new Map(), body: text.trim() }
}

function skillRequirements(fields: Map<string, string>): { baseline: 'standard' | 'extended'; platforms: string[] } {
  const raw = (fields.get('baseline') ?? '').trim()
  if (raw !== '' && raw !== 'standard' && raw !== 'extended') {
    throw new Error(`baseline \`${raw}\` is not standard | extended`)
  }
  const platforms: string[] = []
  for (const part of (fields.get('platforms') ?? '').split(',')) {
    const p = part.trim()
    if (!p) continue
    if (!SKILL_PLATFORMS.includes(p)) throw new Error(`platform \`${p}\` is not one of ${SKILL_PLATFORMS.join(', ')}`)
    if (!platforms.includes(p)) platforms.push(p)
  }
  return { baseline: raw === 'extended' ? 'extended' : 'standard', platforms }
}

function skillScope(fields: Map<string, string>): SkillScope {
  let ui = false
  let work = false
  for (const part of (fields.get('scope') ?? '').split(',')) {
    const word = part.trim()
    if (word === 'ui') ui = true
    else if (word === 'work') work = true
    else if (word) throw new Error(`scope \`${word}\` is not ui | work`)
  }
  return ui ? (work ? 'ui,work' : 'ui') : 'work'
}

function skillCommandsOf(fields: Map<string, string>): string[] {
  const commands = (fields.get('commands') ?? '').split(',').map((c) => c.trim())
    .filter((c) => c && !c.startsWith('.') && /^[A-Za-z0-9._+-]+$/.test(c))
  return commands.filter((c, index) => index === 0 || commands[index - 1] !== c)
}

function textOf(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    return undefined
  }
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/** Where a package file lands, and the skill it belongs to. */
function place(path: string): { kind: SkillKind; name: string } {
  const bad = (hint = ''): never => {
    throw new Error(
      `\`${path}\` is not a skill file: a skill package holds <cmd_skills|plan_skills|goal_skills>/<name>/${SKILL_MANUAL} and their ${SKILL_REFERENCES}/…${hint}`,
    )
  }
  const parts = path.split('/')
  if (parts.some((p) => p === '' || p === '.' || p === '..')) bad()
  if (parts[0] === TOOLS_DIR) {
    throw new Error(
      `\`${path}\`: a skill is text only and brings no command or install script; publish the commands as an extension package and name them in the manual's \`commands\``,
    )
  }
  const kind = SKILL_KINDS.find((k) => SKILL_KIND_DIRS[k] === parts[0])
  if (!kind || parts.length < 2) return bad()
  if (parts.length === 2) {
    return bad(parts[1].endsWith('.md') ? ` (a flat ${parts[0]}/<name>.md is no skill: move it to ${parts[0]}/${parts[1].slice(0, -3)}/${SKILL_MANUAL})` : '')
  }
  const manual = parts.length === 3 && parts[2] === SKILL_MANUAL
  const reference = parts.length >= 4 && parts[2] === SKILL_REFERENCES
  if (!manual && !reference) bad()
  const name = parts[1]
  if (name.length > MAX_NAME_LEN || name.startsWith('.') || !/^[A-Za-z0-9_.-]+$/.test(name)) bad()
  return { kind, name }
}

function packageSkills(packageName: string, files: Map<string, SkillPackageFile>, findings: SkillFinding[]): LintedSkill[] {
  const paths = [...files.keys()].sort()
  const grouped = new Map<string, { kind: SkillKind; name: string; paths: string[] }>()
  for (const path of paths) {
    const { kind, name } = place(path)
    const key = `${SKILL_KINDS.indexOf(kind)}:${name}`
    if (!grouped.has(key)) grouped.set(key, { kind, name, paths: [] })
    grouped.get(key)!.paths.push(path)
  }
  const binary = paths.find((path) => textOf(files.get(path)!.bytes) === undefined)
  if (binary) throw new Error(`${binary} is not UTF-8 text: a skill is text only`)
  if (grouped.size === 0) {
    throw new Error(`package ${packageName} holds no skill (<cmd_skills|plan_skills|goal_skills>/<name>/${SKILL_MANUAL})`)
  }
  const out: LintedSkill[] = []
  const groups = [...grouped.values()].sort((a, b) =>
    SKILL_KINDS.indexOf(a.kind) - SKILL_KINDS.indexOf(b.kind) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  )
  for (const { kind, name, paths: own } of groups) {
    const dir = SKILL_KIND_DIRS[kind]
    const manual = `${dir}/${name}/${SKILL_MANUAL}`
    const file = files.get(manual)
    if (!file) throw new Error(`${dir}/${name}/ has no ${SKILL_MANUAL}`)
    const text = textOf(file.bytes)
    if (text === undefined) throw new Error(`${manual} is not UTF-8 text`)
    const { fields, body } = splitFrontMatter(text)
    let requirements: ReturnType<typeof skillRequirements>
    let scope: SkillScope
    try {
      requirements = skillRequirements(fields)
      scope = skillScope(fields)
      if (kind !== 'work') {
        for (const key of ['scope', 'commands']) {
          if ((fields.get(key) ?? '').trim()) {
            throw new Error(`a ${kind} skill declares no \`${key}\`: it names no commands and is read, not frozen`)
          }
        }
      }
    } catch (error) {
      throw new Error(`${manual}: ${(error as Error).message}`)
    }
    if (fields.has('name') && fields.get('name') !== name) {
      throw new Error(`${manual}: front matter name \`${fields.get('name')}\` differs from its directory`)
    }
    const refPrefix = `${dir}/${name}/${SKILL_REFERENCES}/`
    const skill: LintedSkill = {
      kind,
      name,
      scope: kind === 'work' ? scope : 'work',
      description: fields.get('description') ?? '',
      requires: fields.get('requires') ?? '',
      baseline: requirements.baseline,
      platforms: requirements.platforms,
      commands: skillCommandsOf(fields),
      size: byteLength(body),
      references: own.filter((p) => p.startsWith(refPrefix)).map((p) => p.slice(refPrefix.length)),
    }
    const add = (code: string, level: string, note: string) => findings.push({ code, level, where: manual, note })
    if (!skill.description.trim()) add('no_description', 'medium', 'no `description`: whoever chooses manuals only sees the name')
    const texts = [body]
    for (const path of own) {
      if (!path.includes(`/${SKILL_REFERENCES}/`) || !path.endsWith('.md')) continue
      const reference = textOf(files.get(path)!.bytes)
      if (reference !== undefined) texts.push(reference)
    }
    const used = [...new Set(texts.flatMap((t) => [...commandsInManual(t)]))].sort()
    if (kind === 'work') {
      if (skill.scope !== 'work' && skill.size > UI_MANUAL_WARN_BYTES) {
        add('ui_manual_large', 'low', `${skill.size} bytes: every conversation that takes it carries them (advised: at most ${UI_MANUAL_WARN_BYTES})`)
      }
      const undeclared = used.filter((c) => !skill.commands.includes(c) && !STANDARD_COMMANDS.includes(c))
      if (undeclared.length) add('undeclared_commands', 'low', `the manual runs ${undeclared.join(', ')} without naming them in \`commands\``)
      const lower = texts.map((t) => t.toLowerCase())
      const unused = skill.commands.filter((c) => !lower.some((t) => t.includes(c.toLowerCase())))
      if (unused.length) add('unused_commands', 'low', `\`commands\` names ${unused.join(', ')} but the manual never mentions them`)
    } else if (kind === 'plan') {
      if (skill.size > PLAN_MANUAL_WARN_BYTES) {
        add('plan_manual_large', 'low', `${skill.size} bytes (advised: at most ${PLAN_MANUAL_WARN_BYTES}): a plan reads it whole`)
      }
      const hard = texts.some((t) =>
        t.includes('create-worksession') || t.includes('--cmd-skill') ||
        t.split('\n').some((l) => l.includes('--skill ') && !l.includes('--skill <'))
      )
      if (hard || used.length) {
        add(
          'plan_depends_on_commands',
          'medium',
          'a plan skill says how to split, order and check work, not which commands or manuals to use: move commands into a work skill and write "give this step a manual for X"',
        )
      }
    }
    out.push(skill)
  }
  return out
}

const PACKAGE_MANAGERS = [
  'apt-get ', 'apt install', 'brew install', 'npm install -g', 'npm i -g', 'pip install', 'pip3 install', 'winget install',
  'choco install', 'dnf install', 'yum install', 'apk add',
]
const SECRET_WORDS = ['TOKEN', 'SECRET', 'PASSWORD', 'API_KEY', 'APIKEY', 'PRIVATE_KEY']

/** What `skills.install_plan` tells the owner about the content of a package (Rust: `plan()`), as far as it can be told
 * without the Agent: nothing about what it replaces. */
function riskFindings(skills: LintedSkill[], files: Map<string, SkillPackageFile>, findings: SkillFinding[]): void {
  const paths = [...files.keys()].sort()
  for (const skill of skills) {
    const dir = SKILL_KIND_DIRS[skill.kind]
    const key = `${skill.kind}:${skill.name}`
    if (skill.scope !== 'work') {
      findings.push({ code: 'ui_scope', level: 'medium', where: key, note: 'its scope includes `ui`: once the owner adds it to the UI set it goes into the prompt of every conversation' })
    }
    for (const path of paths) {
      if (!path.startsWith(`${dir}/${skill.name}/`)) continue
      const text = textOf(files.get(path)!.bytes)
      if (text === undefined) continue
      const lower = asciiLower(text)
      const piped = lower.split('\n').some((l) =>
        (l.includes('curl ') || l.includes('wget ')) && (l.includes('| sh') || l.includes('|sh') || l.includes('| bash') || l.includes('|bash'))
      )
      if (piped) {
        findings.push({ code: 'network_script', level: 'high', where: path, note: 'tells the agent to download a script and run it (`curl … | sh`)' })
      }
      const managers = PACKAGE_MANAGERS.filter((m) => lower.includes(m))
      if (managers.length) {
        findings.push({ code: 'package_manager', level: 'medium', where: path, note: `uses a package manager (${managers.join(', ').replaceAll('  ', ' ')})` })
      }
      if (lower.split('\n').some((l) => l.split(/\s+/).includes('sudo'))) {
        findings.push({ code: 'privilege', level: 'high', where: path, note: 'asks for root (`sudo`)' })
      }
      const secrets = [...new Set(
        text.split(/[^A-Za-z0-9_]/).filter((w) => w.length > 5 && /^[A-Z0-9_]+$/.test(w) && SECRET_WORDS.some((s) => w.includes(s))),
      )].sort()
      if (secrets.length) {
        findings.push({ code: 'secrets', level: 'medium', where: path, note: `reads secrets from the environment (${secrets.join(', ')})` })
      }
    }
  }
}

/** The content digest of a package (Rust: `content_digest`): `sha256:<hex>` over the lines `<path>|<sha256 of the file>`
 * in path order. The Agent reports the same value as `digest` of the install plan and of the installed package. */
export function skillContentDigest(files: Map<string, SkillPackageFile>): string {
  const lines = [...files.keys()].sort().map((path) => `${path}|${sha256Bytes(files.get(path)!.bytes)}\n`)
  return `sha256:${sha256Bytes(new TextEncoder().encode(lines.join('')))}`
}

/** Check a skill package without an Agent (`pikg doctor`, a directory given to `skill install`). A package that cannot
 * be installed gets one `invalid_package` finding of level `error`, first; the rest is advice. */
export function lintSkillPackage(packageName: string, files: Map<string, SkillPackageFile>): SkillLintResult {
  const findings: SkillFinding[] = []
  try {
    const skills = packageSkills(packageName, files, findings)
    riskFindings(skills, files, findings)
    return { skills, findings }
  } catch (error) {
    findings.unshift({ code: 'invalid_package', level: 'error', where: packageName, note: (error as Error).message })
    return { skills: [], findings }
  }
}

/** A directory laid out like the `agent_skills` sub package, read as `pikg build` archives it: the skill directories
 * only (`revisions/` of a manual left out; a `tools/` is read so that the package is refused for it), links followed
 * while they stay inside. */
export async function readSkillDirectory(
  root: string,
  limit: number,
): Promise<{ files: Map<string, SkillPackageFile>; ignored: string[] }> {
  const host = getHost()
  const realRoot = await host.realPath(root)
  const files = new Map<string, SkillPackageFile>()
  const ignored: string[] = []
  let total = 0
  const walk = async (directory: string, prefix: string): Promise<void> => {
    const children = (await host.readDir(directory)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const child of children) {
      const rel = prefix ? `${prefix}/${child.name}` : child.name
      const parts = rel.split('/')
      if (parts.length > 32) throw new Error(`${rel}: nested too deep`)
      if (!prefix && !SKILL_DIRS.includes(child.name)) {
        ignored.push(rel)
        continue
      }
      if (parts[0] !== TOOLS_DIR && parts.length === 3 && parts[2] === SKILL_REVISIONS) continue
      let path = host.path.join(directory, child.name)
      if ((await host.lstat(path)).isSymlink) {
        path = await host.realPath(path)
        const inside = host.path.relative(realRoot, path)
        if (inside === '..' || inside.startsWith(`..${host.path.sep}`) || host.path.isAbsolute(inside)) {
          throw new Error(`${rel}: a link out of the skill directory`)
        }
      }
      const info = await host.stat(path)
      if (info.isDirectory) {
        await walk(path, rel)
      } else if (info.isFile) {
        total += info.size
        if (total > limit) throw new Error(`the skill directory holds more than ${limit} bytes`)
        files.set(rel, { bytes: await host.readFile(path) })
      } else {
        throw new Error(`${rel}: not a regular file`)
      }
    }
  }
  await walk(realRoot, '')
  return { files, ignored }
}
