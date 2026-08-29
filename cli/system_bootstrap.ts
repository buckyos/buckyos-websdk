#!/usr/bin/env -S deno run

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDistributionPolicy, TOOL_ENVIRONMENT_NAMES } from './runtime/host.ts'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const environment = Object.fromEntries(
  TOOL_ENVIRONMENT_NAMES.map((name) => [name, Deno.env.get(name)]),
)
const runtime = Deno.execPath()
const policy = buildDistributionPolicy({
  distribution: 'system',
  argv: Deno.args,
  cwd: Deno.cwd(),
  packageRoot,
  homeDir: environment.HOME ?? environment.USERPROFILE ?? Deno.cwd(),
  environment,
  path: await import('node:path'),
  buckyosRoot: environment.BUCKYOS_ROOT,
})
const permissions = [
  '--no-prompt',
  ...policy.readPaths.map((path) => `--allow-read=${path}`),
  ...policy.writePaths.map((path) => `--allow-write=${path}`),
  `--allow-env=${policy.environment.join(',')}`,
  ...policy.subprocesses.map((command) => `--allow-run=${command}`),
  ...(policy.network ? ['--allow-net'] : []),
]
const status = await new Deno.Command(runtime, {
  args: [
    'run',
    ...permissions,
    resolve(packageRoot, 'cli', 'system_launcher.ts'),
    ...Deno.args,
  ],
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
}).spawn().status
Deno.exitCode = status.code
