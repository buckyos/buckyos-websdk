export interface AccountInfo {
    user_name: string;
    user_id: string;
    user_type: string;
    session_token: string;
}
export declare const LOGIN_EVENT = "onLogin";
export declare function hashPassword(username: string, password: string, nonce?: number | null): string;
export declare function cleanLocalAccountInfo(appId: string): void;
export declare function saveLocalAccountInfo(appId: string, account_info: AccountInfo): void;
export declare function getLocalAccountInfo(appId: string): AccountInfo | null;
export declare function doLogin(username: string, password: string): Promise<AccountInfo | null>;
//# sourceMappingURL=account.d.ts.map