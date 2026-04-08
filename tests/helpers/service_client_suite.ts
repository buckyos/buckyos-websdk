/**
 * Shared ServiceClient integration suite.
 *
 * According to tests/测试用例组织.md, every runtime integration test follows three phases:
 *
 *   1) runtime-specific env initialization
 *   2) run ServiceClient tests against the initialized SDK
 *   3) run runtime-specific assertions
 *
 * This helper provides phase (2): a reusable set of Jest cases that run
 * against an already initialized + logged in `buckyos` module. Each runtime
 * integration test is expected to perform phase (1) in `beforeAll` and then
 * call {@link defineSharedServiceClientSuite} with a getter that returns the
 * shared `buckyos` module (which is a singleton across dynamic imports).
 */

import type { SystemConfigClient } from '../../src/system_config_client'
import type { TaskManagerClient } from '../../src/task_mgr_client'
import { TaskStatus } from '../../src/task_mgr_client'

/**
 * Structural shape of the `buckyos` module that this suite needs. Using a
 * structural type instead of importing the concrete module type avoids
 * coupling to whether the caller dynamically or statically imports the
 * SDK entry point.
 */
type BuckyosLikeModule = {
  getSystemConfigClient: () => SystemConfigClient
  getTaskManagerClient: () => TaskManagerClient
  getAppSetting: (name?: string | null) => Promise<unknown>
  setAppSetting: (name: string | null, value: string) => Promise<void>
}

export interface SharedSuiteContext {
  /** Returns the logged-in `buckyos` singleton module. */
  getSdk: () => BuckyosLikeModule
  /** App id used to namespace test data. */
  getAppId: () => string
  /** Current logged-in user id; task manager create requires this. */
  getUserId: () => string
  /**
   * Skip the task manager case when the runtime/environment cannot
   * create tasks (for example browser-with-password login may not own
   * a task namespace).
   */
  skipTaskManager?: boolean
  /**
   * Skip the settings round trip case when the runtime cannot write
   * through `setAppSetting` (for example, runtimes where no writable
   * settings namespace is available for the test account).
   */
  skipSettings?: boolean
}

/**
 * Attach the shared ServiceClient describe/it blocks to the current Jest
 * test file. Must be called from within a parent `describe` block after
 * the runtime has performed its init phase in `beforeAll`.
 */
export function defineSharedServiceClientSuite(context: SharedSuiteContext): void {
  describe('shared ServiceClient suite', () => {
    it('SystemConfigClient reads boot/config', async () => {
      const sdk = context.getSdk()
      const bootConfig = await sdk.getSystemConfigClient().get('boot/config')
      const parsed = JSON.parse(bootConfig.value) as Record<string, unknown>

      expect(parsed).toEqual(expect.any(Object))
      expect(Object.keys(parsed).length).toBeGreaterThan(0)
    })

    it('SystemConfigClient writes and reads back a namespaced key', async () => {
      const sdk = context.getSdk()
      const appId = context.getAppId()
      const userId = context.getUserId()
      // Write under the logged-in user's own namespace so the test does not
      // depend on having permission to write the shared `test/...` tree.
      const key = `users/${userId}/test_websdk/${appId}/${Date.now()}`
      const value = JSON.stringify({ ok: true, key })

      await sdk.getSystemConfigClient().set(key, value)
      await expect(sdk.getSystemConfigClient().get(key)).resolves.toEqual(
        expect.objectContaining({ value }),
      )
    })

    if (!context.skipSettings) {
      it('getAppSetting/setAppSetting round trip on namespaced key', async () => {
        const sdk = context.getSdk()
        const settingPath = `test_settings.websdk_${Date.now()}`

        await sdk.setAppSetting(settingPath, '"roundtrip"')
        await expect(sdk.getAppSetting(settingPath)).resolves.toBe('roundtrip')
      })
    }

    if (!context.skipTaskManager) {
      it('TaskManagerClient creates/updates/queries/deletes a namespaced task', async () => {
        const sdk = context.getSdk()
        const client = sdk.getTaskManagerClient()
        const userId = context.getUserId()
        const appId = context.getAppId()
        const name = `test-websdk-${Date.now()}`
        const created = await client.createTask({
          name,
          taskType: 'test',
          data: { createdBy: 'websdk' },
          userId,
          appId,
        })

        try {
          await client.updateTaskProgress(created.id, 1, 2)
          await client.updateTaskStatus(created.id, TaskStatus.Completed)

          const fetched = await client.getTask(created.id)
          const filtered = await client.listTasks({ filter: { root_id: String(created.id) } })

          expect(fetched.status).toBe(TaskStatus.Completed)
          expect(filtered.map((task) => task.id)).toContain(created.id)
        } finally {
          await client.deleteTask(created.id).catch(() => undefined)
        }
      })
    }
  })
}
