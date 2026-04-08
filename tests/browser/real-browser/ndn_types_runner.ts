// Browser-side runner for the shared ndn_types test cases.
//
// This is bundled by `vite.test-browser.config.ts` into a self-contained
// ESM file (dist-tests/ndn_types_runner.mjs) that the
// `tests/browser/real-browser/ndn_types.html` page loads as a module.
// `prepare_real_browser_test.mjs` then copies that bundle + the HTML page
// into the systest's dist directory so the playwright spec can drive it
// from a real browser tab.
//
// The actual test logic lives in tests/ndn_types_cases.ts and is shared
// with the jest-driven node runner in tests/ndn_types.test.ts.

import { NDN_TYPES_TEST_CASES, runNdnTypesCases } from '../../ndn_types_cases'

declare global {
    interface Window {
        __NDN_TYPES_TEST_RESULT__?: unknown
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
    window.__NDN_TYPES_TEST_RESULT__ = value
}

function runOnce() {
    setStatus('running', 'Running')
    setSummary(`Running ${NDN_TYPES_TEST_CASES.length} cases...`)

    let outcome: ReturnType<typeof runNdnTypesCases>
    try {
        outcome = runNdnTypesCases()
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
        return
    }

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
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runOnce, { once: true })
} else {
    runOnce()
}
