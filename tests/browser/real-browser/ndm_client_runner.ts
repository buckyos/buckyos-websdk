// Browser-side runner for the shared ndm_client test cases.
//
// This is bundled by `vite.test-browser.config.ts` into a self-contained
// ESM file (dist-tests/ndm_client_runner.mjs) that the
// `tests/browser/real-browser/ndm_client.html` page loads as a module.
// `prepare_real_browser_test.mjs` then copies that bundle + the HTML page
// into the systest's dist directory so the playwright spec can drive it
// from a real browser tab.
//
// The actual test logic lives in tests/ndm_client_cases.ts and is shared
// with the jest-driven node runner in tests/ndm_client.test.ts.

import { NDM_CLIENT_TEST_CASES, runNdmClientCases } from '../../ndm_client_cases'

declare global {
    interface Window {
        __NDM_CLIENT_TEST_RESULT__?: unknown
    }
}

function setStatus(state: 'running' | 'passed' | 'failed', text: string) {
    const node = document.getElementById('status')
    if (!node) return
    node.setAttribute('data-state', state)
    node.textContent = text
}

function setSummary(text: string) {
    const node = document.getElementById('summary')
    if (node) node.textContent = text
}

function setResult(value: unknown) {
    const node = document.getElementById('result')
    if (node) node.textContent = JSON.stringify(value, null, 2)
    window.__NDM_CLIENT_TEST_RESULT__ = value
}

async function runOnce() {
    setStatus('running', 'Running')
    setSummary(`Running ${NDM_CLIENT_TEST_CASES.length} cases...`)

    try {
        const outcome = await runNdmClientCases()

        setResult({
            ok: outcome.ok,
            total: outcome.total,
            failed: outcome.failed,
            results: outcome.results,
            userAgent: navigator.userAgent,
        })
        setSummary(
            outcome.ok
                ? `All ${outcome.total} cases passed.`
                : `${outcome.failed} of ${outcome.total} cases failed.`,
        )
        setStatus(outcome.ok ? 'passed' : 'failed', outcome.ok ? 'Passed' : 'Failed')
    } catch (e) {
        const err = e as Error
        setStatus('failed', 'Failed (runner crashed)')
        setSummary('runner crashed before completing all cases')
        setResult({
            ok: false,
            error: {
                name: err?.name,
                message: err?.message,
                stack: err?.stack ?? null,
            },
        })
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { void runOnce() }, { once: true })
} else {
    void runOnce()
}
