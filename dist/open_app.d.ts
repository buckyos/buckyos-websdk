/**
 * Opening an App. Whatever starts it (an icon, a notification, another App, an external link) becomes one
 * `OpenAppRequest`; `resolveOpenApp` decides between a new window and one that is already open. The shell and the
 * native client share these rules, and `tests/open_app_vectors.json` holds the cases both run.
 */
export interface OpenAppRequest {
    /** Zone DID. Required: there is no implicit "current Zone". */
    zone: string;
    /** App id; a system App uses its id in the system App list (`files`, `messagehub`, …). */
    app: string;
    /** The page inside the App, with its query and fragment. */
    path?: string;
    /** Window path, named by the App: the same path is the same window. Empty is the App's main window. */
    window?: string;
    /** Defaults to `reuse`. `new` only applies to Apps that declare several windows. */
    mode?: 'reuse' | 'new';
}
/** `window` of an AppDoc and of an entry in the system App list. */
export interface AppWindowDeclaration {
    instance: 'single' | 'multi';
    default_mode: 'windowed' | 'maximized';
    width?: number;
    height?: number;
    min_width?: number;
    min_height?: number;
    resizable: boolean;
    allow_minimize: boolean;
    allow_maximize: boolean;
    mobile_header: 'standard' | 'compact';
}
/** Reads a declaration leniently: a missing or invalid field takes its default. */
export declare function readAppWindowDeclaration(value: unknown): AppWindowDeclaration;
/** `<zone>|<appInstance>|<windowPath>`, each part percent-encoded. */
export declare function appWindowId(zone: string, appInstance: string, windowPath?: string): string;
export declare function parseAppWindowId(id: string): {
    zone: string;
    appInstance: string;
    windowPath: string;
} | undefined;
export interface OpenAppWindow {
    id: string;
    zone: string;
    appInstance: string;
    windowPath: string;
    /** The page shown now, when it is known. */
    path?: string;
    /** When the window was last used; only compared with that of other windows. */
    lastActive: number;
}
export type OpenAppDecision = {
    action: 'create';
    windowId: string;
    windowPath: string;
    path?: string;
}
/** `navigate`: the page to go to inside that window. */
 | {
    action: 'focus';
    windowId: string;
    navigate?: string;
};
/**
 * Where a request goes. `appInstance` is what the caller resolved `request.app` to; `windows` are all open windows
 * (those of other Zones and Apps are ignored here). A window path given as `''` names the main window, which is not
 * the same as giving none.
 */
export declare function resolveOpenApp(request: OpenAppRequest, appInstance: string, declaration: AppWindowDeclaration, windows: OpenAppWindow[]): OpenAppDecision;
/** A request from an App: without a Zone it means the App's own. */
export type AppOpenRequest = Omit<OpenAppRequest, 'zone'> & {
    zone?: string;
};
/** A page inside an App: `/…` that cannot leave the App's origin when it is resolved against it. */
export declare function isAppPath(value: unknown): value is string;
/** Checks a request that crossed a window boundary and returns a clean copy. */
export declare function readAppOpenRequest(value: unknown): AppOpenRequest | undefined;
/** The Zone root page that opens an App: where a standalone tab sends the user. */
export declare function systemOpenAppUrl(systemOrigin: string, request: Omit<AppOpenRequest, 'zone'>): string;
/** Inverse of `systemOpenAppUrl`; the Zone is the one serving the page. */
export declare function parseSystemOpenApp(params: URLSearchParams): Omit<AppOpenRequest, 'zone'> | undefined;
/** `buckyos://<action>?v=<version>&…`. Undefined when it is not a well-formed BuckyOS address. */
export declare function parseBuckyosUrl(url: string): {
    action: string;
    version: number;
    params: URLSearchParams;
} | undefined;
export interface AppOpenLink {
    zoneHost: string;
    app: string;
    path?: string;
    window?: string;
}
export declare const APP_OPEN_ACTION = "app.open";
export declare function formatAppOpenUrl(link: AppOpenLink): string;
export declare function parseAppOpenUrl(url: string): AppOpenLink | undefined;
//# sourceMappingURL=open_app.d.ts.map