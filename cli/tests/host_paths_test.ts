import * as path from 'node:path'
import type { DistributionPolicy } from '../runtime/host.ts'
import { DenoHost } from '../runtime/host_deno.ts'
import { NodeHost } from '../runtime/host_node.ts'
import { assertEquals, assertRejects } from './test_helpers.ts'

function policy(readPaths: string[], writePaths = readPaths): DistributionPolicy {
  return {
    name: 'developer-default',
    distribution: 'developer',
    packageRoot: Deno.cwd(),
    readPaths,
    writePaths,
    environment: [],
    subprocesses: [],
    network: false,
  }
}

for (const Host of [DenoHost, NodeHost]) {
  Deno.test(`${Host.name} accepts native temporary paths and their canonical paths`, async () => {
    const root = await Deno.makeTempDir()
    try {
      const host = new Host(policy([root, path.join(root, 'not-created')]))
      const file = path.join(root, 'value.txt')
      await host.writeTextFile(file, 'value')
      assertEquals(await host.readTextFile(file), 'value')
      const physical = await host.realPath(root)
      assertEquals(await host.readTextFile(path.join(physical, 'value.txt')), 'value')
      await host.writeTextFile(path.join(physical, 'new.txt'), 'new')
      assertEquals(await host.readTextFile(path.join(root, 'new.txt')), 'new')
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  })

  Deno.test(`${Host.name} accepts a policy root beneath a directory alias`, async () => {
    const root = await Deno.makeTempDir()
    try {
      const physical = path.join(await Deno.realPath(root), 'physical')
      const alias = path.join(root, 'alias')
      await Deno.mkdir(path.join(physical, 'project'), { recursive: true })
      await Deno.symlink(physical, alias, { type: 'junction' })
      const project = path.join(alias, 'project')
      const host = new Host(policy([project]))
      await host.writeTextFile(path.join(project, 'value.txt'), 'value')
      assertEquals(await host.readTextFile(path.join(project, 'value.txt')), 'value')
      const canonical = await host.realPath(project)
      assertEquals(canonical, path.join(physical, 'project'))
      assertEquals(await host.readTextFile(path.join(canonical, 'value.txt')), 'value')
      assertEquals((await host.lstat(canonical)).isDirectory, true)
      await host.writeTextFile(path.join(canonical, 'new.txt'), 'new', { createNew: true })
      assertEquals(await host.readTextFile(path.join(project, 'new.txt')), 'new')

      const config = path.join(alias, 'new-config')
      const configHost = new Host(policy([config]))
      await configHost.mkdir(config, { recursive: true })
      await configHost.writeTextFile(path.join(config, 'config.json'), '{}')
      assertEquals(await configHost.readTextFile(path.join(config, 'config.json')), '{}')
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  })

  Deno.test(`${Host.name} rejects escapes from an aliased root and keeps reads separate`, async () => {
    const root = await Deno.makeTempDir()
    try {
      const physical = path.join(await Deno.realPath(root), 'physical')
      const alias = path.join(root, 'alias')
      const outside = path.join(await Deno.realPath(root), 'outside')
      await Deno.mkdir(physical)
      await Deno.mkdir(outside)
      await Deno.writeTextFile(path.join(outside, 'secret.txt'), 'secret')
      await Deno.symlink(physical, alias, { type: 'junction' })
      await Deno.symlink(outside, path.join(physical, 'escape'), { type: 'junction' })
      const host = new Host(policy([alias]))
      for (
        const candidate of [
          path.join(alias, 'escape', 'secret.txt'),
          path.join(physical, 'escape', 'secret.txt'),
          path.join(alias, '..', 'outside', 'secret.txt'),
          path.join(root, 'alias-other', 'secret.txt'),
        ]
      ) {
        await assertRejects(() => host.readTextFile(candidate), 'PermissionDenied')
        await assertRejects(() => host.writeTextFile(candidate, 'changed'), 'PermissionDenied')
      }
      assertEquals(await Deno.readTextFile(path.join(outside, 'secret.txt')), 'secret')

      const readOnly = new Host(policy([alias, outside], [alias]))
      assertEquals(await readOnly.readTextFile(path.join(outside, 'secret.txt')), 'secret')
      await assertRejects(
        () => readOnly.writeTextFile(path.join(alias, 'escape', 'secret.txt'), 'changed'),
        'PermissionDenied',
      )
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  })
}
