#!/usr/bin/env -S deno run

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCli } from './main.ts'
import { buildDistributionPolicy, installHost, TOOL_ENVIRONMENT_NAMES } from './runtime/host.ts'
import { DenoHost } from './runtime/host_deno.ts'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const environment = Object.fromEntries(
  TOOL_ENVIRONMENT_NAMES.map((name) => [name, Deno.env.get(name)]),
)
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
const host = new DenoHost(policy)
installHost(host)
Deno.exitCode = await runCli(host, Deno.args)
