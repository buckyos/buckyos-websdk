import * as path from 'node:path'
import { tmpdir } from 'node:os'
import { installHost, TOOL_ENVIRONMENT_NAMES } from '../runtime/host.ts'
import { DenoHost } from '../runtime/host_deno.ts'

const cwd = Deno.cwd()
installHost(
  new DenoHost({
    name: 'developer-default',
    distribution: 'developer',
    packageRoot: path.resolve(cwd),
    readPaths: [path.resolve(cwd, '..'), tmpdir()],
    writePaths: [path.resolve(cwd), tmpdir()],
    environment: TOOL_ENVIRONMENT_NAMES.filter((name) => name !== 'BUCKYOS_ROOT'),
    subprocesses: ['docker'],
    network: true,
  }),
)
