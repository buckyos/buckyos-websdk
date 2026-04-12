// Jest wrapper around the runtime-agnostic ndm_client test cases.
//
// The actual test logic lives in tests/ndm_client_cases.ts so that the same
// cases can be executed in any runtime — node (jest, here), browser (via
// tests/browser/real-browser/ndm_client.html + playwright), and any future
// host that needs to validate the ndm_client layer end-to-end.

import { NDM_CLIENT_TEST_CASES, defaultAsyncTap } from './ndm_client_cases'
import {
    setImportProvider,
    getImportProvider,
    pickupAndImport,
    ImportProvider,
    RuntimeCapabilities,
    ImportedFileObject,
} from '../src/ndm_client'

describe('ndm_client (shared cases)', () => {
    for (const c of NDM_CLIENT_TEST_CASES) {
        it(c.name, async () => {
            await c.run(defaultAsyncTap)
        })
    }
})

// ============================================================
// Jest-only tests that are too heavy for the browser runner
// ============================================================

function makeFile(name: string, content: Uint8Array | string, type = 'application/octet-stream'): File {
    const data = typeof content === 'string' ? new TextEncoder().encode(content) : content
    return new File([data], name, { type })
}

function mockProvider(
    caps: Partial<RuntimeCapabilities> = {},
    files: File[] = [],
): ImportProvider {
    return {
        getCapabilities() {
            return {
                canRevealRealPath: false,
                canUseNDMCache: false,
                canUseNDMStore: false,
                canPickDirectory: false,
                canPickMixed: false,
                ...caps,
            }
        },
        pickFiles: jest.fn().mockResolvedValue(files),
    }
}

describe('ndm_client (jest-only)', () => {
    let originalProvider: ImportProvider
    beforeAll(() => { originalProvider = getImportProvider() })
    afterEach(() => { setImportProvider(originalProvider) })

    it('materializes a file larger than 4 MiB into multiple chunks', async () => {
        // 5 MiB exceeds the 4 MiB default chunk size
        const size = 5 * 1024 * 1024
        const data = new Uint8Array(size)
        for (let i = 0; i < size; i++) data[i] = i & 0xff

        setImportProvider(mockProvider({}, [makeFile('big.bin', data)]))
        const result = await pickupAndImport({ mode: 'single_file' })

        const sel = result.selection as ImportedFileObject
        expect(sel.kind).toBe('file')
        expect(sel.size).toBe(size)
        expect(sel.objectId).toBeTruthy()
        expect(sel.objectId).toContain(':')
    })
})
