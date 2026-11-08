import type { AgentRuntime, SiteTool } from './types';
export declare const SITE_RUNTIME_KIND = "site";
export interface SiteRuntimeOptions {
    /** The scene name, e.g. `aiws.wish`: part of the runtime's identity. */
    scene: string;
    /** The page's origin (passed in: the runtime never reads `location`). */
    origin: string;
    hostname: string;
    /** Every tool of this scene. */
    tools: Record<string, SiteTool>;
    /** What `{{env.NAME}}` may read. */
    env?: Record<string, string>;
    /** `runtime.task_wait_ms` (in-call wait budget for tasks, M2). */
    task_wait_ms?: number;
}
export interface SiteRuntime extends AgentRuntime {
    readonly scene: string;
    /** The scene's tools, by name. */
    readonly tools: ReadonlyMap<string, SiteTool>;
}
export declare function createSiteRuntime(options: SiteRuntimeOptions): SiteRuntime;
//# sourceMappingURL=site.d.ts.map