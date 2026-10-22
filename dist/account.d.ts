export interface AccountInfo {
    user_name: string;
    user_id: string;
    /**
     * A Zone account type (`admin` | `user` | `limited` | `root`, see
     * `ZoneUserType`) for user sessions, `service` for an AppService runtime.
     * Kept as a string: an unknown value must not break the session.
     */
    user_type?: string;
    session_token: string;
    refresh_token?: string;
}
export interface BrowserUserInfo {
    user_name: string;
    user_id: string;
    /** Zone account type as verify-hub returned it; see `ZoneUserType`. */
    user_type: string;
}
export declare const LOGIN_EVENT = "onLogin";
export declare function hashPassword(username: string, password: string, nonce?: number | null): string;
export declare function cleanLocalAccountInfo(appId: string): void;
export declare function saveLocalAccountInfo(appId: string, account_info: AccountInfo): void;
export declare function saveBrowserUserInfo(userInfo: BrowserUserInfo): void;
export declare function getBrowserUserInfo(): BrowserUserInfo | null;
export declare function clearBrowserUserInfo(): void;
/** The last current identity `/sso_refresh` returned (raw JSON, parse with `parseCurrentIdentity`). */
export declare function saveBrowserIdentity(identity: unknown): void;
export declare function getBrowserIdentityRaw(): unknown;
export declare function clearBrowserIdentity(): void;
export declare function getLocalAccountInfo(appId: string): AccountInfo | null;
//# sourceMappingURL=account.d.ts.map