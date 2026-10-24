import { kRPCClient } from './krpc_client';
import { type AccessDenial } from './hybrid_sso';
export declare const APP_LOGIN_ISSUE_METHOD = "user.app_login.issue";
export declare const APP_LOGIN_EXCHANGE_METHOD = "auth.app_login.exchange";
export declare const APP_LOGIN_SETTINGS_GET_METHOD = "apps.app_login.get";
export declare const APP_LOGIN_SETTINGS_SET_METHOD = "apps.app_login.set";
export type AppLoginResource = {
    kind: 'group_session';
    group_did: string;
    session_id: string;
    title?: string;
};
export interface IssueAppLoginCodeParams {
    /** The App's own identifier of the customer; only its digest is stored. */
    external_account_id: string;
    /** Must be the account already bound to `external_account_id`; never another one. */
    user_id?: string;
    /** Display name of a newly created account. */
    show_name?: string;
    /** A group Session to invite the account into as a guest, as the App owner. */
    resource?: AppLoginResource;
    /** Path on the App's origin the exchange returns to (default `/`). */
    return_path?: string;
}
export interface IssuedAppLoginCode {
    user_id: string;
    code: string;
    expires_at: number;
    new_account: boolean;
    invite: Record<string, unknown>;
}
export type AppLoginExchangeResult = {
    status: 'ready';
    callback_url: string;
    user_id: string;
} | {
    status: 'denied';
    denial: AccessDenial;
};
export interface AppLoginSettings {
    enabled: boolean;
    updated_by: string;
    updated_at: number;
}
/** App backend side: `client` is a control-panel kRPC client holding the App's service token. */
export declare function issueAppLoginCode(client: kRPCClient, params: IssueAppLoginCodeParams): Promise<IssuedAppLoginCode>;
export declare function parseAppLoginExchangeResult(value: unknown): AppLoginExchangeResult | null;
export declare function randomAppLoginNonce(): string;
export interface LoginByAppAccessTokenParams {
    code: string;
    /** Reusing the nonce makes a retry idempotent; a new nonce for a used code is refused. */
    nonce?: string;
    return_path?: string;
    /** Control Panel kRPC URL; the gateway routes `/kapi/control-panel` from any App origin. */
    controlPanelUrl?: string;
    client?: kRPCClient;
}
/**
 * App page side: exchanges the code for a restricted session targeting the App
 * instance that issued it. On `ready` the page navigates to `callback_url`
 * (`completeAppAccessTokenLogin`), which sets the cookies and returns to `return_path`.
 */
export declare function loginByAppAccessToken(params: LoginByAppAccessTokenParams): Promise<AppLoginExchangeResult>;
export declare function completeAppAccessTokenLogin(params: LoginByAppAccessTokenParams, navigate?: (url: string) => void): Promise<AppLoginExchangeResult>;
//# sourceMappingURL=app_login.d.ts.map