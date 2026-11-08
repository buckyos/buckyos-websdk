// The shared xllm cases on Deno, against the built bundle (`pnpm build` first):
// core and the site runtime run unchanged on Deno with Web standard APIs only.
import * as x from '../../dist/xllm.mjs'
import * as dev from '../../dist/xllm_dev.mjs'
import { XLLM_CASES } from '../xllm_cases.ts'

for (const c of XLLM_CASES) {
  Deno.test(c.name, () => c.run({ x, dev }))
}
