interface AuthClientOptions {
    navigate?: (url: string) => void;
}
export declare class AuthClient {
    zoneHostname: string;
    clientId: string;
    private readonly navigate;
    constructor(zoneBaseUrl: string, appId: string, options?: AuthClientOptions);
    buildLoginURL(redirectUri?: string | null): string;
    login(redirectUri?: string | null): Promise<void>;
}
export {};
//# sourceMappingURL=auth_client.d.ts.map