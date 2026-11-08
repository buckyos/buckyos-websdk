// Opening a runtime's tools for a new run (shared by `prepareHosted` and `prepare`).

import type { LoopModel, RuntimeConfig, ToolsConfig } from './types'
import { shellSettings, taskWaitMs } from './config'
import type { AgentRuntime } from '../runtime/types'
import type { RunningTaskResolver } from '../runtime/task_model'

/** Open the runtime's tools for a run and the configuration saved with it. */
export async function openRuntime(runtime: AgentRuntime, configured: RuntimeConfig, workdir: string,
  loopModel: LoopModel, sources: Record<string, string>, toolsCfg: ToolsConfig, tasks?: RunningTaskResolver) {
  const runtimeConfig = runtime.config()
  if (configured.task_wait_ms !== undefined) runtimeConfig.task_wait_ms = configured.task_wait_ms
  if (configured.baseline !== undefined) runtimeConfig.baseline = configured.baseline
  const opened = await runtime.open({ workdir, run_id: 'pending', loop_model: loopModel, sources, env: {}, tasks,
    task_wait_ms: taskWaitMs(runtimeConfig) }, toolsCfg)
  const tools = { ...opened.tools, shell: shellSettings(toolsCfg.shell, taskWaitMs(runtimeConfig)) }
  return { tools, manager: opened.manager, runtimeConfig }
}
