import type { LoopModel, RuntimeConfig, ToolsConfig } from './types';
import type { AgentRuntime } from '../runtime/types';
import type { RunningTaskResolver } from '../runtime/task_model';
/** Open the runtime's tools for a run and the configuration saved with it. */
export declare function openRuntime(runtime: AgentRuntime, configured: RuntimeConfig, workdir: string, loopModel: LoopModel, sources: Record<string, string>, toolsCfg: ToolsConfig, tasks?: RunningTaskResolver): Promise<{
    tools: {
        shell: import("./types").ShellSettings;
        enabled: boolean;
        filesystem_policy: import("./types").FilesystemPolicy;
        tools2actions: boolean;
        tool_sources: import("./types").ToolSource[];
        action_sources: import("./types").ToolSource[];
        native: import("./types").ResolvedTool[];
        actions: import("./types").ResolvedTool[];
        bash_tools: import("./types").BashToolManual[];
        exec_enabled: boolean;
        sources: Record<string, string>;
    };
    manager: import("../runtime/types").RunToolManager;
    runtimeConfig: RuntimeConfig;
}>;
//# sourceMappingURL=open_runtime.d.ts.map