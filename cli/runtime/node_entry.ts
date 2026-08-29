import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { runCli } from '../main.ts'
import { buildDistributionPolicy, installHost, TOOL_ENVIRONMENT_NAMES } from './host.ts'
import { NodeHost } from './host_node.ts'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const environment = Object.fromEntries(
  TOOL_ENVIRONMENT_NAMES.map((name) => [name, process.env[name]]),
)
const policy = buildDistributionPolicy({
  distribution: 'developer',
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  packageRoot,
  homeDir: process.env.HOME ?? process.env.USERPROFILE ?? process.cwd(),
  environment,
  path: await import('node:path'),
})
const host = new NodeHost(policy)
installHost(host)
host.setExitCode(await runCli(host, process.argv.slice(2)))
