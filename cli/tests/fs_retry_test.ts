import { retryWindowsLock } from '../runtime/fs_retry.ts'
import { assertEquals, assertRejects } from './test_helpers.ts'

function locked(): Error {
  return Object.assign(new Error('EPERM'), { code: 'EPERM' })
}

Deno.test('retryWindowsLock retries a sharing violation and then succeeds', async () => {
  let calls = 0
  const result = await retryWindowsLock(
    true,
    () => {
      calls++
      if (calls < 3) throw locked()
      return Promise.resolve('ok')
    },
    (error) => (error as { code?: string }).code === 'EPERM',
    () => 1,
  )
  assertEquals(result, 'ok')
  assertEquals(calls, 3)
})

Deno.test('retryWindowsLock does not retry outside Windows', async () => {
  let calls = 0
  await assertRejects(
    () =>
      retryWindowsLock(false, () => {
        calls++
        return Promise.reject(locked())
      }, () =>
        true, () =>
        1),
    'EPERM',
  )
  assertEquals(calls, 1)
})

Deno.test('retryWindowsLock stops when the error is not a sharing violation', async () => {
  let calls = 0
  await assertRejects(() =>
    retryWindowsLock(true, () => {
      calls++
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    }, (error) =>
      (error as { code?: string }).code === 'EPERM', () =>
      1)
  )
  assertEquals(calls, 1)
})
