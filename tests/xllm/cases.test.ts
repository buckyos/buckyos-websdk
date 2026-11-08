// Shared xllm cases (tests/xllm_cases.ts) against the source under jest.
import * as x from '../../src/xllm'
import * as dev from '../../src/xllm/dev'
import { XLLM_CASES } from '../xllm_cases'

describe('xllm shared cases', () => {
  for (const c of XLLM_CASES) {
    test(c.name, () => c.run({ x, dev }), 20000)
  }
})
