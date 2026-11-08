export declare class DIDObjectError extends Error {
    readonly code: string;
    readonly status: number;
    readonly details?: unknown;
    constructor(code: string, message: string, status: number, details?: unknown);
}
export interface DIDObjectCard {
    id: string;
    alsoKnownAs?: string[];
    controller?: string;
    service?: unknown[];
    [key: string]: unknown;
}
export interface DIDObjectClientOptions {
    /** Gateway origin, e.g. `location.origin`. */
    origin: string;
    currentZone?: string | null;
    fetch?: typeof fetch;
    /** A bearer token; without it same-origin requests carry the SSO cookie. */
    sessionToken?: () => string | null | undefined | Promise<string | null | undefined>;
}
type Json = null | boolean | number | string | Json[] | {
    [key: string]: Json;
};
export declare class DIDObjectClient {
    private readonly options;
    constructor(options: DIDObjectClientOptions);
    /** HTTP endpoint of an object URL (`obj://…`, or http(s) as it is). */
    endpoint(objectUrl: string): string;
    card(objectUrl: string): Promise<DIDObjectCard>;
    profile(objectUrl: string): Promise<Json>;
    readProperty(objectUrl: string, name: string): Promise<Json>;
    invoke(objectUrl: string, method: string, params: Json): Promise<Json>;
    /** The endpoint without its query (property and method paths go before it). */
    private split;
    private request;
}
export {};
//# sourceMappingURL=did_object_client.d.ts.map