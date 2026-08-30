import './setup.ts'
import { parseBuckyOSDevConfig } from '../core/development_mode.ts'
import { assertEquals, assertRejects } from './test_helpers.ts'

Deno.test('BuckyOSDevConfig accepts enabled and retained disabled audit metadata', () => {
  assertEquals(
    parseBuckyOSDevConfig({
      schema_version: 1,
      enabled: true,
      enabled_at: 1_800_000_000,
      enabled_by: 'alice',
    }).enabled,
    true,
  )
  assertEquals(
    parseBuckyOSDevConfig({
      schema_version: 1,
      enabled: false,
      enabled_at: 1_800_000_000,
      enabled_by: 'alice',
    }).enabled,
    false,
  )
})

Deno.test('BuckyOSDevConfig rejects unknown schema and invalid audit fields', async () => {
  await assertRejects(() =>
    Promise.resolve().then(() =>
      parseBuckyOSDevConfig({
        schema_version: 2,
        enabled: true,
        enabled_at: null,
        enabled_by: null,
      })
    )
  )
  await assertRejects(() =>
    Promise.resolve().then(() =>
      parseBuckyOSDevConfig({
        schema_version: 1,
        enabled: true,
        enabled_at: null,
        enabled_by: null,
      })
    )
  )
})
