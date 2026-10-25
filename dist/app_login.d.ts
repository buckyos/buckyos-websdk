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
    /** Where the customer lands after signing in: a path on the App's origin for a code, on the Zone root for a link (default `/`). */
    return_path?: string;
}
export interface IssuedAppLoginCode {
    user_id: string;
    code: string;
    expires_at: number;
    new_account: boolean;
    invite: Record<string, unknown>;
}
export interface IssuedAppCustomerLink {
    user_id: string;
    /** `https://<zone>/sso/invite/<id>#s=<secret>`; the secret is in the fragment only. */
    link: string;
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
/**
 * App backend side: a 48-hour customer link on the Zone root. `return_path` is a
 * Zone-root path (for a group Session usually `/messagehub/guest?group=&session=`),
 * not a path on the App's origin.
 */
export declare function issueAppCustomerLink(client: kRPCClient, params: IssueAppLoginCodeParams): Promise<IssuedAppCustomerLink>;
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