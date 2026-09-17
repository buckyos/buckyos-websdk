import type {
  CommandDefinition,
  CommandModule,
  JsonSchema,
  OptionDefinition,
} from '../core/command.ts'
import type { CommandContext } from '../core/context.ts'
import {
  EXIT_OPERATION,
  EXIT_PARTIAL,
  EXIT_PERMISSION,
  EXIT_USAGE,
  ToolError,
  UsageError,
} from '../core/errors.ts'
import { getHost, isHostError } from '../runtime/host.ts'
import { TOOL_VERSION } from '../version.ts'
import * as provisionSdk from 'buckyos/provision'

// provision: first activation of an installed, not yet activated BuckyOS root on
// this machine (single OOD, did:web, no SN/BNS). Every command is local: no
// Zone session, no verify-hub, no TaskManager, no network. The activation
// implementation lives in the SDK (buckyos/provision); this module is the thin
// argv/confirmation/secret/output layer described in doc/modules/provision.md.

// The built SDK entry is untyped for `deno check` (as buckyos/node is for the
// core); these interfaces mirror the API documented in src/provision_activate.ts.
export type ActivationState = 'not_installed' | 'unactivated' | 'partial' | 'configured' | 'invalid'

export interface ActivationProblem {
  code: string
  message: string
}

export interface ActivationFileEntry {
  path: string
  role: string
  required: boolean
  secret: boolean
}

export interface ObservedActivationFile extends ActivationFileEntry {
  present: boolean
}

export interface CommittedActivationFile extends ActivationFileEntry {
  sha256: string | null
}

export interface ActivationDnsRecord {
  type: 'A' | 'AAAA'
  name: string
  value: string
}

export interface ActivationLockInfo {
  path: string
  schemaVersion: number | null
  traceId: string | null
  startedAt: number | null
  domain: string | null
  stage: string | null
  committedFiles: string[]
  ownerKeyBackupPath: string | null
  corrupt: boolean
}

export interface ActivationStatus {
  rootDir: string
  state: ActivationState
  startupRequired: boolean
  observedAt: number
  zoneDid: string | null
  ownerDid: string | null
  deviceDid: string | null
  deviceName: string | null
  accessHostname: string | null
  files: ObservedActivationFile[]
  problems: ActivationProblem[]
  warnings: string[]
  lock: ActivationLockInfo | null
}

export interface OfflineActivationCheckOptions {
  rootDir: string
  domain: string
  ownerName: string
  ownerKeyBackupPath: string
  rtcpPort?: number
  guestAccess?: boolean
  publicIp?: string
}

export interface OfflineActivationOptions extends OfflineActivationCheckOptions {
  adminPassword: string
  traceId?: string
}

export interface OfflineActivationPrecheck {
  ready: boolean
  rootDir: string
  state: ActivationState
  domain: string
  ownerName: string
  ownerDid: string
  zoneDid: string
  deviceDid: string
  deviceName: string
  accessHostname: string
  rtcpPort: number
  guestAccess: boolean
  publicIp: string | null
  dnsRecords: ActivationDnsRecord[]
  ownerKeyBackup: { path: string; directoryExists: boolean; exists: boolean }
  plannedFiles: ActivationFileEntry[]
  problems: ActivationProblem[]
  status: ActivationStatus
}

export interface OfflineActivationResult {
  rootDir: string
  state: 'configured'
  startupRequired: true
  domain: string
  ownerName: string
  ownerDid: string
  zoneDid: string
  deviceDid: string
  deviceName: string
  accessHostname: string
  rtcpPort: number
  guestAccess: boolean
  publicIp: string | null
  documentIat: number
  documentExp: number
  ownerKeyBackup: { path: string; saved: true }
  dnsRecords: ActivationDnsRecord[]
  committedFiles: CommittedActivationFile[]
  warnings: string[]
}

interface ProvisionSdk {
  inspectActivationRoot(rootDir: string): Promise<ActivationStatus>
  checkOfflineActivation(options: OfflineActivationCheckOptions): Promise<OfflineActivationPrecheck>
  activateOfflineZone(options: OfflineActivationOptions): Promise<OfflineActivationResult>
}

const sdk = provisionSdk as unknown as ProvisionSdk

export interface ProvisionModuleDependencies {
  inspect?: ProvisionSdk['inspectActivationRoot']
  check?: ProvisionSdk['checkOfflineActivation']
  activate?: ProvisionSdk['activateOfflineZone']
}

const OBJECT_OUTPUT: JsonSchema = { type: 'object', additionalProperties: true }

const ROOT_OPTION: OptionDefinition = {
  name: 'root',
  description:
    'Installed BuckyOS root on this machine (BUCKYOS_ROOT); read by status/check, written by activate',
  type: 'string',
  required: true,
}

const TARGET_OPTIONS: OptionDefinition[] = [
  ROOT_OPTION,
  {
    name: 'domain',
    description: 'Fixed public host name; Owner DID and Zone DID become did:web:<domain>',
    type: 'string',
    required: true,
  },
  {
    name: 'owner-name',
    property: 'owner_name',
    description: 'Local administrator / OwnerDocument name (lowercase DNS label)',
    type: 'string',
    required: true,
  },
  {
    name: 'owner-key-backup',
    property: 'owner_key_backup',
    description:
      'New file for the Owner private-key recovery copy; its directory must exist and the file must not',
    type: 'string',
    required: true,
  },
  {
    name: 'public-ip',
    property: 'public_ip',
    description: 'Fixed public IP used only for the A/AAAA record instructions',
    type: 'string',
  },
  {
    name: 'rtcp-port',
    property: 'rtcp_port',
    description: 'RTCP port, default 2980',
    type: 'integer',
  },
  {
    name: 'guest-access',
    property: 'guest_access',
    description: 'Enable guest access in the first-boot configuration',
    type: 'boolean',
  },
]

const TARGET_INPUT_PROPERTIES: Record<string, JsonSchema> = {
  root: { type: 'string', minLength: 1 },
  domain: { type: 'string', minLength: 1 },
  owner_name: { type: 'string', minLength: 1 },
  owner_key_backup: { type: 'string', minLength: 1 },
  public_ip: { type: 'string' },
  rtcp_port: { type: 'integer', minimum: 1 },
  guest_access: { type: 'boolean' },
}

const TARGET_REQUIRED = ['root', 'domain', 'owner_name', 'owner_key_backup']

const POLICY_NOTE =
  'Paths are read from argv by the launcher to grant the minimal filesystem permissions; ' +
  'root and owner_key_backup given only inside --input are limited to the policy roots (cwd, ' +
  'and the paired BUCKYOS_ROOT of the system distribution).'

export function createProvisionModule(
  dependencies: ProvisionModuleDependencies = {},
): CommandModule {
  const deps: ResolvedDependencies = {
    inspect: dependencies.inspect ?? sdk.inspectActivationRoot,
    check: dependencies.check ?? sdk.checkOfflineActivation,
    activate: dependencies.activate ?? sdk.activateOfflineZone,
  }
  return {
    name: 'provision',
    summary: 'Activate an installed BuckyOS root on this machine (first Zone, Owner, and OOD)',
    commands: [statusCommand(deps), checkCommand(deps), activateCommand(deps)],
  }
}

type ResolvedDependencies = Required<ProvisionModuleDependencies>

function statusCommand(deps: ResolvedDependencies): CommandDefinition {
  return {
    verb: 'status',
    summary: 'Inspect the local activation material of an installed BuckyOS root',
    description:
      'Read-only. Reports not_installed, unactivated, partial, configured, or invalid from the ' +
      'files under the root; configured only means the first-boot material is complete and internally ' +
      'consistent (startup_required=true). Service health, DNS, TLS, and public DID discovery are not checked. ' +
      POLICY_NOTE,
    options: [ROOT_OPTION],
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string', minLength: 1 } },
      required: ['root'],
      additionalProperties: false,
    },
    outputSchema: {
      ...OBJECT_OUTPUT,
      properties: {
        root: { type: 'string' },
        state: {
          type: 'string',
          enum: ['not_installed', 'unactivated', 'partial', 'configured', 'invalid'],
        },
        startup_required: { type: 'boolean' },
      },
      required: ['root', 'state', 'startup_required'],
    },
    resultSchemaVersion: 1,
    access: { mode: 'fixed', level: 'read' },
    asyncMode: 'sync',
    requiresSession: false,
    execution: 'local',
    networkAccess: false,
    examples: ['buckyos provision status --root /opt/buckyos'],
    handler: async (ctx, input) => {
      const root = resolvePath(ctx, requiredString(input, 'root'))
      await assertHostAccess(root, 'read')
      return statusView(await runSdk(() => deps.inspect(root)))
    },
  }
}

function checkCommand(deps: ResolvedDependencies): CommandDefinition {
  return {
    verb: 'check',
    summary: 'Validate activation parameters and the target root without writing anything',
    description:
      'Read-only precheck shared with activate: parameters, target state, and the owner key ' +
      'backup location. No keys are generated, no backup is written, and no operation is produced; ' +
      'activate re-validates the target itself. Fails with the first problem code when the target is not ready. ' +
      POLICY_NOTE,
    options: TARGET_OPTIONS,
    inputSchema: {
      type: 'object',
      properties: TARGET_INPUT_PROPERTIES,
      required: TARGET_REQUIRED,
      additionalProperties: false,
    },
    outputSchema: {
      ...OBJECT_OUTPUT,
      properties: {
        ready: { type: 'boolean' },
        root: { type: 'string' },
        state: { type: 'string' },
      },
      required: ['ready', 'root', 'state'],
    },
    resultSchemaVersion: 1,
    access: { mode: 'fixed', level: 'read' },
    asyncMode: 'sync',
    requiresSession: false,
    execution: 'local',
    networkAccess: false,
    examples: [
      'buckyos provision check --root /opt/buckyos --domain corp.example.com --owner-name admin --owner-key-backup /secure-backup/corp-owner.pem',
    ],
    handler: async (ctx, input) => {
      const options = activationOptions(ctx, input)
      await assertHostAccess(options.rootDir, 'read')
      await assertHostAccess(getHost().path.dirname(options.ownerKeyBackupPath), 'read')
      const precheck = await runSdk(() => deps.check(options))
      if (!precheck.ready) throw precheckError(precheck)
      return precheckView(precheck)
    },
  }
}

function activateCommand(deps: ResolvedDependencies): CommandDefinition {
  return {
    verb: 'activate',
    summary:
      'Activate the root: create the first Zone, Owner, and OOD identity and the first-boot configuration',
    description:
      'Privileged local write. Generates random Ed25519 Owner/device keys and current-time documents, ' +
      'saves the Owner private-key backup, then commits the identity, Zone, and start_config files; ' +
      'etc/node_identity.json is written last because node-daemon treats it as the activation switch. ' +
      'The administrator password is read from the secret admin_password field of --input JSON or from a ' +
      'hidden terminal prompt; there is no --admin-password option. Non-interactive runs require --yes. ' +
      'Repeated, partial, and invalid targets are rejected; there is no --force. After success restart ' +
      'BuckyOS through the installer or node control entry; this command never reports the Zone as online. ' +
      POLICY_NOTE,
    options: TARGET_OPTIONS,
    inputSchema: {
      type: 'object',
      properties: {
        ...TARGET_INPUT_PROPERTIES,
        admin_password: {
          type: 'string',
          secret: true,
          description: 'Administrator password (secret; --input JSON or hidden prompt only)',
        },
      },
      required: TARGET_REQUIRED,
      additionalProperties: false,
    },
    outputSchema: {
      ...OBJECT_OUTPUT,
      properties: {
        root: { type: 'string' },
        state: { type: 'string', enum: ['configured'] },
        startup_required: { type: 'boolean' },
      },
      required: ['root', 'state', 'startup_required'],
    },
    resultSchemaVersion: 1,
    access: { mode: 'fixed', level: 'privileged' },
    asyncMode: 'sync',
    requiresSession: false,
    execution: 'local',
    networkAccess: false,
    examples: [
      'buckyos provision activate --root /opt/buckyos --domain corp.example.com --owner-name admin --owner-key-backup /secure-backup/corp-owner.pem',
      'buckyos --non-interactive --yes --input activation.json provision activate --root /opt/buckyos --owner-key-backup /secure-backup/corp-owner.pem',
    ],
    handler: async (ctx, input) => {
      const options = activationOptions(ctx, input)
      const backupDirectory = getHost().path.dirname(options.ownerKeyBackupPath)
      await assertHostAccess(options.rootDir, 'read')
      await assertHostAccess(options.rootDir, 'write')
      await assertHostAccess(backupDirectory, 'read')
      await assertHostAccess(backupDirectory, 'write')
      const precheck = await runSdk(() => deps.check(options))
      if (!precheck.ready) throw precheckError(precheck)
      const adminPassword = await obtainAdminPassword(ctx, input)
      await confirmActivation(ctx, precheck)
      const result = await runSdk(() =>
        deps.activate({ ...options, adminPassword, traceId: ctx.traceId })
      )
      return resultView(ctx, input, result)
    },
  }
}

// ---------------------------------------------------------------------------
// input handling
// ---------------------------------------------------------------------------

function activationOptions(
  ctx: CommandContext,
  input: Record<string, unknown>,
): OfflineActivationCheckOptions {
  return {
    rootDir: resolvePath(ctx, requiredString(input, 'root')),
    domain: requiredString(input, 'domain'),
    ownerName: requiredString(input, 'owner_name'),
    ownerKeyBackupPath: resolvePath(ctx, requiredString(input, 'owner_key_backup')),
    publicIp: optionalString(input, 'public_ip'),
    rtcpPort: typeof input.rtcp_port === 'number' ? input.rtcp_port : undefined,
    guestAccess: input.guest_access === true,
  }
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = optionalString(input, key)
  if (!value) throw new UsageError('INVALID_ARGUMENT', `${key} is required`)
  return value
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function resolvePath(ctx: CommandContext, value: string): string {
  const path = getHost().path
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(ctx.cwd, value)
}

async function assertHostAccess(path: string, operation: 'read' | 'write'): Promise<void> {
  try {
    await getHost().assertAccess(path, operation)
  } catch (error) {
    if (isHostError(error, 'PermissionDenied')) {
      throw new ToolError(
        'HOST_ACCESS_DENIED',
        `${error.message}; pass the path on the command line (--root / --owner-key-backup) so the launcher can grant it`,
        EXIT_PERMISSION,
        false,
        { path, operation },
      )
    }
    throw error
  }
}

async function obtainAdminPassword(
  ctx: CommandContext,
  input: Record<string, unknown>,
): Promise<string> {
  if (typeof input.admin_password === 'string') return input.admin_password
  if (ctx.config.nonInteractive) {
    throw new UsageError(
      'SECRET_REQUIRED',
      'admin_password must be provided through --input JSON in non-interactive mode',
    )
  }
  if (!ctx.io.inputIsTerminal) {
    throw new UsageError(
      'SECRET_INPUT_UNAVAILABLE',
      'the administrator password requires an interactive terminal or --input JSON',
    )
  }
  const host = getHost()
  let password: string
  let confirmation: string
  try {
    password = await host.readSecret('Administrator password: ')
    confirmation = await host.readSecret('Confirm administrator password: ')
  } catch (error) {
    if (isHostError(error, 'PermissionDenied')) {
      throw new UsageError('SECRET_INPUT_UNAVAILABLE', error.message)
    }
    throw error
  }
  if (password !== confirmation) {
    throw new UsageError('PASSWORD_MISMATCH', 'the administrator passwords do not match')
  }
  return password
}

async function confirmActivation(
  ctx: CommandContext,
  precheck: OfflineActivationPrecheck,
): Promise<void> {
  if (ctx.confirmed) return
  if (ctx.config.nonInteractive) {
    throw new ToolError(
      'CONFIRMATION_REQUIRED',
      'provision activate requires --yes in non-interactive mode',
      EXIT_PERMISSION,
    )
  }
  if (!ctx.io.inputIsTerminal) {
    throw new ToolError(
      'CONFIRMATION_REQUIRED',
      'provision activate requires an interactive terminal or --yes',
      EXIT_PERMISSION,
    )
  }
  await ctx.io.stderr(
    [
      'Activation summary',
      `  BUCKYOS_ROOT : ${precheck.rootDir}`,
      `  Owner/Zone   : ${precheck.zoneDid}`,
      `  Device       : ${precheck.deviceDid}`,
      `  Admin        : ${precheck.ownerName}`,
      `  Network      : ${'wan'} (no SN, no BNS)`,
      `  RTCP port    : ${precheck.rtcpPort}`,
      `  Guest access : ${precheck.guestAccess}`,
      `  Owner backup : ${precheck.ownerKeyBackup.path}`,
      '',
    ].join('\n'),
  )
  const answer = (await ctx.io.prompt('Write this activation to disk? [y/N] '))?.trim()
    .toLowerCase()
  if (answer !== 'y' && answer !== 'yes') {
    throw new ToolError('CONFIRMATION_DECLINED', 'activation was declined', EXIT_PERMISSION)
  }
}

// ---------------------------------------------------------------------------
// SDK error mapping
// ---------------------------------------------------------------------------

interface SdkError extends Error {
  code: string
  details: Record<string, unknown>
}

function isSdkError(error: unknown): error is SdkError {
  return error instanceof Error && error.name === 'ActivationError' &&
    typeof (error as { code?: unknown }).code === 'string'
}

async function runSdk<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (isSdkError(error)) {
      const exitCode = error.code === 'INVALID_ARGUMENT'
        ? EXIT_USAGE
        : error.code === 'ACTIVATION_COMMIT_FAILED'
        ? EXIT_PARTIAL
        : EXIT_OPERATION
      throw new ToolError(error.code, error.message, exitCode, false, error.details ?? {})
    }
    throw error
  }
}

function precheckError(precheck: OfflineActivationPrecheck): ToolError {
  const [first] = precheck.problems
  const single = precheck.problems.length === 1
  return new ToolError(
    single ? first.code : 'ACTIVATION_PRECHECK_FAILED',
    single
      ? first.message
      : `activation precheck failed: ${precheck.problems.map((p) => p.message).join('; ')}`,
    EXIT_OPERATION,
    false,
    precheckView(precheck),
  )
}

// ---------------------------------------------------------------------------
// output views (snake_case, never secrets)
// ---------------------------------------------------------------------------

function statusView(status: ActivationStatus): Record<string, unknown> {
  return {
    root: status.rootDir,
    state: status.state,
    startup_required: status.startupRequired,
    observed_at: status.observedAt,
    zone_did: status.zoneDid,
    owner_did: status.ownerDid,
    device_did: status.deviceDid,
    device_name: status.deviceName,
    access_hostname: status.accessHostname,
    files: status.files.map((file) => ({
      path: file.path,
      role: file.role,
      required: file.required,
      secret: file.secret,
      present: file.present,
    })),
    problems: status.problems,
    warnings: status.warnings,
    lock: status.lock
      ? {
        path: status.lock.path,
        stage: status.lock.stage,
        trace_id: status.lock.traceId,
        started_at: status.lock.startedAt,
        domain: status.lock.domain,
        committed_files: status.lock.committedFiles,
        owner_key_backup: status.lock.ownerKeyBackupPath,
        corrupt: status.lock.corrupt,
      }
      : null,
  }
}

function precheckView(precheck: OfflineActivationPrecheck): Record<string, unknown> {
  return {
    ready: precheck.ready,
    root: precheck.rootDir,
    state: precheck.state,
    domain: precheck.domain,
    owner_name: precheck.ownerName,
    owner_did: precheck.ownerDid,
    zone_did: precheck.zoneDid,
    device_did: precheck.deviceDid,
    device_name: precheck.deviceName,
    access_hostname: precheck.accessHostname,
    rtcp_port: precheck.rtcpPort,
    guest_access: precheck.guestAccess,
    public_ip: precheck.publicIp,
    dns_records: precheck.dnsRecords,
    owner_key_backup: {
      path: precheck.ownerKeyBackup.path,
      directory_exists: precheck.ownerKeyBackup.directoryExists,
      exists: precheck.ownerKeyBackup.exists,
    },
    planned_files: precheck.plannedFiles,
    problems: precheck.problems,
    target: statusView(precheck.status),
  }
}

function resultView(
  ctx: CommandContext,
  input: Record<string, unknown>,
  result: OfflineActivationResult,
): Record<string, unknown> {
  const dnsNotes = [
    ...result.dnsRecords.map((record) => `${record.type} ${record.name} ${record.value}`),
    ...(result.publicIp ? [] : [`A/AAAA ${result.domain} <this node's fixed public IP>`]),
    `The address record is also saved in etc/zone_dns_records.json under ${result.rootDir}.`,
    `Local boot uses etc/${result.domain}.zone.json; no DNS BOOT/PKX/DEV records are required.`,
    'TLS/ACME is not provided by SN in this mode; configure it on the public gateway.',
  ]
  return {
    root: result.rootDir,
    state: result.state,
    startup_required: result.startupRequired,
    domain: result.domain,
    owner_name: result.ownerName,
    owner_did: result.ownerDid,
    zone_did: result.zoneDid,
    device_did: result.deviceDid,
    device_name: result.deviceName,
    access_hostname: result.accessHostname,
    rtcp_port: result.rtcpPort,
    guest_access: result.guestAccess,
    public_ip: result.publicIp,
    document_iat: result.documentIat,
    document_exp: result.documentExp,
    owner_key_backup: result.ownerKeyBackup,
    dns_records: result.dnsRecords,
    dns_notes: dnsNotes,
    committed_files: result.committedFiles,
    warnings: result.warnings,
    next_steps: [
      'Restart BuckyOS through the installer or the node control entry to leave activation mode and boot the new Zone.',
      'Check the running Zone afterwards with system status; activation does not verify service health, DNS, or TLS.',
      `Keep the Owner private-key backup ${result.ownerKeyBackup.path} offline; it is the only recovery copy.`,
    ],
    audit: {
      module: ctx.command.module,
      verb: ctx.command.verb,
      trace_id: ctx.traceId,
      tool_version: TOOL_VERSION,
      input_fingerprint: inputFingerprint(input),
    },
  }
}

function inputFingerprint(input: Record<string, unknown>): string {
  const material: Record<string, unknown> = {}
  for (const key of Object.keys(TARGET_INPUT_PROPERTIES).sort()) {
    if (input[key] !== undefined) material[key] = input[key]
  }
  const hash = getHost().createHash('sha256')
  hash.update(new TextEncoder().encode(JSON.stringify(material)))
  return hash.digestHex()
}
