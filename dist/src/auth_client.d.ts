import { AccountInfo } from "./account";
export declare class AuthClient {
    zone_hostname: string;
    clientId: string;
    cookieOptions: any;
    authWindow: Window | null;
    constructor(zone_base_url: string, appId: string);
    login(redirect_uri?: string | null): Promise<AccountInfo | null>;
    request(action: string, params: any): Promise<void>;
    _openAuthWindow(redirect_uri?: string | null): Promise<string>;
}
//# sourceMappingURL=auth_client.d.ts.map