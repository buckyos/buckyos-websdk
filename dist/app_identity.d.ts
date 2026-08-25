export type AppId = string;
export type AppDID = string;
export type AppInstanceId = string;
export interface ParsedAppInstanceId {
    appId: AppId;
    ownerUserId: string;
}
export declare function appIdFromDid(appDid: AppDID): AppId;
export declare function parseAppId(value: string): AppId;
export declare function appDidFromId(value: string): AppDID;
export declare function createAppInstanceId(appId: string, ownerUserId: string): AppInstanceId;
export declare function parseAppInstanceId(value: string): ParsedAppInstanceId;
//# sourceMappingURL=app_identity.d.ts.map