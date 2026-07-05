import { DID } from './namelib';
import { IdentityRoots } from './cert';
import { DevTestKeyPair } from './dev_test_keys';
import { BuckyOSZoneTxtRecord } from './types';
export { NODE_IDENTITY_SCHEMA_V2, DEVICE_DOC_JWT_FILE_NAME, DEVICE_MINI_DOC_JWT_FILE_NAME, NODE_GATEWAY_PARAMS_FILE_NAME, buildDeviceDid, bindDeviceDocumentDid, newDeviceDocumentByJwkWithDid, newLocalNodeIdentityConfig, loadLocalNodeIdentityConfig, deviceIdentityPathsForRoots, saveLocalDeviceIdentityForRoots, saveNodeGatewayParams, loadDeviceDocJwtForRoots, loadDeviceMiniDocJwtForRoots, loadLocalDeviceDocumentForRoots, decodeDeviceDocumentWithoutVerify, } from './device_identity';
export type { BuckyOSLocalNodeIdentityConfig, DeviceIdentityPaths, NewLocalNodeIdentityConfigParams } from './device_identity';
export { IdentityRoots, IDENTITY_MATERIALS, IDENTITY_USAGES, createCa, createCertFromCa, createIdentityCertFromCa, didWebDocumentUrl, encodeIdentityDirName, ensureCa, identityDirName, identityFileName, identityRawHostUri, } from './cert';
export type { CreateCaResult, CreateCertResult, CreateIdentityCertFromCaOptions, CreateIdentityCertResult, IdentityDirMatch, IdentityMatchType, IdentityMaterial, IdentityRootsOptions, IdentityUsage, X509PathMatch, X509Paths, } from './cert';
export { DEV_TEST_KEYS, getDevTestKeyPairById } from './dev_test_keys';
export type { DevTestKeyPair } from './dev_test_keys';
export declare const PROVISION_BASE_TIME = 1743478939;
export declare const PROVISION_DEFAULT_EXP: number;
export declare function assertProvisionRuntime(): void;
export interface CreateUserEnvParams {
    username: string;
    hostname: string;
    oodName: string;
    snBaseHost?: string;
    rtcpPort?: number;
    outputDir: string;
    ownerKeyPair?: DevTestKeyPair;
    deviceKeyPair?: DevTestKeyPair;
}
export declare function createUserEnv(params: CreateUserEnvParams): Promise<BuckyOSZoneTxtRecord>;
export interface CreateNodeConfigsParams {
    deviceName: string;
    envDir: string;
    netId?: string;
    ownerKeyPair?: DevTestKeyPair;
    deviceKeyPair?: DevTestKeyPair;
    now?: number;
}
export declare function nodeTestIdentityRoots(nodeDir: string): IdentityRoots;
export declare function createNodeConfigs(params: CreateNodeConfigsParams): Promise<string>;
export declare class DevSnDb {
    private readonly dbPath;
    constructor(dbPath: string);
    private connect;
    initializeDatabase(): void;
    insertActivationCode(code: string): void;
    registerUserDirectly(username: string, publicKey: string, zoneConfig: string, userDomain?: string): void;
    registerDevice(username: string, deviceName: string, did: string, miniConfigJwt: string, ip: string, description: string): void;
}
export interface CreateSnConfigsParams {
    outputDir: string;
    snIp: string;
    snBaseHost: string;
}
export declare function createSnConfigs(params: CreateSnConfigsParams): Promise<void>;
export declare function registerUserToSn(rootDir: string, userZoneId: string, snDbPath: string): Promise<void>;
export declare function registerDeviceToSn(rootDir: string, userZoneId: string, deviceName: string, snDbPath: string): Promise<void>;
export interface PackageMetaNode {
    metaJwt: string;
    pkgName: string;
    version: string;
    tag?: string;
    author: string;
    authorPk: string;
}
export declare function versionToInt(version: string): bigint;
export declare function normalizePackageMetaForObjId(meta: Record<string, any>): Record<string, any>;
export declare function calcPkgMetaObjId(metaJson: Record<string, any>): string;
export declare class MetaIndexDb {
    readonly dbPath: string;
    constructor(dbPath: string);
    private connect;
    initializeDatabase(): void;
    addPkgMetaBatch(pkgMetaMap: Record<string, PackageMetaNode>): void;
}
export declare function setPkgMeta(metaPath: string, dbPath: string): Promise<string>;
export declare const KERNEL_SERVICE_DOC_VERSION = "0.7.0";
export declare function uniqueNameToDid(uniqueName: string): DID;
export interface BuildDidDocsOptions {
    version?: string;
    now?: number;
}
export declare function buildDidDocs(outputDir: string, options?: BuildDidDocsOptions): string[];
//# sourceMappingURL=provision.d.ts.map