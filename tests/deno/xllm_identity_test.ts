// Vector (h) `runtime_identity.json` (Rust `xllm::vectors`): the native
// runtime's host id, target, runtime id and descriptor, the probe parser and
// the working-directory lock file name, byte for byte as Rust.
// `pnpm build` first: this imports dist/.

// deno-lint-ignore-file no-explicit-any
import * as host from '../../dist/xllm_deno.mjs'
import { HAVE_VECTORS, VECTORS, eq, fail, fixtureTest } from './xllm_host_helpers.ts'

const file = HAVE_VECTORS ? JSON.parse(await Deno.readTextFile(`${VECTORS}runtime_identity.json`)) : { cases: [{ name: 'all' }] }

for (const c of file.cases as any[]) {
  fixtureTest(`runtime_identity: ${c.name}`, () => {
    if (c.fn === 'native_host_id') {
      eq(host.nativeHostIdFrom(c), c.expect, 'host id')
    } else if (c.fn === 'native_identity') {
      const target = host.nativeTarget(c.host_id, c.probe.uid)
      eq(target, c.expect.target, 'target')
      eq(host.targetText(target), c.expect.target_text, 'blake3 input')
      const id = host.deriveRuntimeId(c.configured_id, 'native', target)
      eq(id, c.expect.runtime_id, 'runtime id')
      const d = host.nativeDescriptor(id, target, c.probe)
      eq(JSON.parse(host.targetText(d)), JSON.parse(host.targetText(c.expect.descriptor)), 'descriptor')
    } else if (c.fn === 'parse_probe') {
      const bytes = new TextEncoder().encode(c.stdout)
      if (c.expect.error) {
        try {
          host.parseProbe(bytes)
        } catch (e: any) {
          eq(e.kind, c.expect.error.kind, 'error kind')
          return
        }
        fail('expected a probe error')
      }
      const p = host.parseProbe(bytes)
      eq({ hostname: p.hostname, machine: p.machine, uid: p.uid }, c.expect.identity, 'identity')
      const info = c.expect.info
      eq(Object.fromEntries(Object.keys(info).map(k => [k, (p as any)[k]])), info, 'info')
      eq(p.path, c.expect.path, 'path')
    } else if (c.fn === 'workdir_lock_path') {
      const path = host.workdirLockPath(c.lock_dir, c.workdir)
      eq(path, c.expect.path, 'lock path')
      eq(path.slice(path.lastIndexOf('/') + 1), c.expect.file_name, 'file name')
    } else {
      fail(`unknown fn ${c.fn}`)
    }
  })
}
