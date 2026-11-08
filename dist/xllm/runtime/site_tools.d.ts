import type { JsonValue } from '../core/types';
import type { SiteTool, SiteToolCtx } from './types';
import type { AccessLevel, JsonSchema, OptionDefinition, PositionalDefinition } from '../../internal/command_args';
export type ActionRisk = 'read_only' | 'idempotent_write' | 'write' | 'destructive' | 'admin';
export declare const ACTION_RISKS: ActionRisk[];
export declare const XCALL_USAGE = "xcall <object> <action> [--params <json>] [key=value ...] [--key=value ...]";
/** Result text cap of `read` (one page) and `exec`. */
export declare const MAX_RESULT_BYTES: number;
/** What a resource method gets: the URI as normalized, the `{name}` parameters, the query. */
export interface ResourceMatch {
    uri: string;
    pattern: string;
    params: Record<string, string>;
    query: URLSearchParams;
    ctx: SiteToolCtx;
}
/** A read may return a version: `write` (and the default `edit`) gets it back as `ifVersion`. */
export interface Versioned {
    content: unknown;
    version?: string;
}
export interface WriteBody {
    content: string;
    mode: 'write' | 'new' | 'append';
    ifVersion?: string;
}
export interface ActionDecl {
    description: string;
    risk: ActionRisk;
    /** JSON Schema of the params. */
    input?: JsonValue;
    call(m: ResourceMatch, params: Record<string, JsonValue>): unknown;
}
export interface ResourceDecl {
    description: string;
    read?(m: ResourceMatch): unknown;
    write?(m: ResourceMatch, body: WriteBody): unknown;
    edit?(m: ResourceMatch, body: {
        old_string: string;
        new_string: string;
    }): unknown;
    actions?: Record<string, ActionDecl>;
}
/** A page command: a subset of the CLI `CommandDefinition`; `call(input)` replaces its handler. */
export interface CommandDecl {
    summary: string;
    description?: string;
    positionals?: PositionalDefinition[];
    options?: OptionDefinition[];
    inputSchema?: JsonSchema;
    access?: {
        mode: 'fixed';
        level: AccessLevel;
    };
    examples?: string[];
    call(input: Record<string, unknown>, ctx: SiteToolCtx): unknown;
}
export interface SiteToolsOptions {
    resources?: Record<string, ResourceDecl>;
    commands?: Record<string, CommandDecl>;
}
/** Normalize a URI the model gave: relative paths and declared absolute origins only, no `..`, no encoded separators. */
export declare function normalizeUri(uri: string, origins: Set<string>): {
    origin?: string;
    segments: string[];
    query: URLSearchParams;
    text: string;
};
/** One page of a text by lines: `offset` is the 1-based first line. */
export declare function pageText(text: string, offset?: number, limit?: number): string;
/**
 * The four basic tools over the page's resources and commands. Spread them
 * into `createSiteRuntime({ tools })`, alongside named tools if wanted.
 */
export declare function siteTools(options: SiteToolsOptions): Record<string, SiteTool>;
//# sourceMappingURL=site_tools.d.ts.map