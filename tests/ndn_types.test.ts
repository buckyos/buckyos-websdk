// Jest wrapper around the runtime-agnostic ndn_types test cases.
//
// The actual test logic lives in tests/ndn_types_cases.ts so that the same
// cases can be executed in any runtime — node (jest, here), browser (via
// tests/browser/real-browser/ndn_types.html + playwright), and any future
// host that needs to validate the NDN types layer end-to-end.

import { NDN_TYPES_TEST_CASES, defaultTap } from './ndn_types_cases'

describe('ndn_types (shared cases)', () => {
    for (const c of NDN_TYPES_TEST_CASES) {
        it(c.name, () => {
            // Run via the default tap (throws Error on failure). Jest will
            // surface the thrown error as the test failure with our message.
            c.run(defaultTap)
        })
    }
})
