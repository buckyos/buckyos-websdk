import { IdentityRoots } from './cert';
import { DID } from './namelib';
import { BuckyOSDeviceDocument, BuckyOSLocalNodeIdentityConfig, Ed25519Jwk, DID as DIDString } from './types';
export { NODE_IDENTITY_SCHEMA_V2 } from './types';
export type { BuckyOSLocalNodeIdentityConfig } from './types';
export declare const DEVICE_DOC_JWT_FILE_NAME = "device_doc.jwt";
export declare const DEVICE_MINI_DOC_JWT_FILE_NAME = "device_mini_doc.jwt";
export declare const NODE_GATEWAY_PARAMS_FILE_NAME = "node_gateway_params.json";
export interface NewLocalNodeIdentityConfigParams {
    zoneDid: DID | DIDString;
    ownerDid: DID | DIDString;
    ownerPublicKey: Ed25519Jwk;
    deviceName: string;
    deviceDid: DID | DIDString;
    zoneIat: number;
}
export declare function newLocalNodeIdentityConfig(params: NewLocalNodeIdentityConfigParams): BuckyOSLocalNodeIdentityConfig;
export declare function loadLocalNodeIdentityConfig(filePath: string): BuckyOSLocalNodeIdentityConfig;
export interface DeviceIdentityPaths {
    publicDir: string;
    securityDir: string;
    didJson: string;
    deviceDocJwt: string;
    deviceMiniDocJwt: string;
    authenticationPrivateKey: string;
}
export declare function deviceIdentityPathsForRoots(roots: IdentityRoots, deviceDid: DID | DIDString): DeviceIdentityPaths;
export declare function buildDeviceDid(deviceName: string, zoneDid: DID | DIDString): DID;
export declare function bindDeviceDocumentDid(deviceDoc: BuckyOSDeviceDocument, deviceDid: DID | DIDString): BuckyOSDeviceDocument;
export declare function newDeviceDocumentByJwkWithDid(name: string, publicKeyJwk: Ed25519Jwk, deviceDid: DID | DIDString, now?: number): BuckyOSDeviceDocument;
export declare function loadDeviceDocJwtForRoots(roots: IdentityRoots, deviceDid: DID | DIDString): string;
export declare function loadDeviceMiniDocJwtForRoots(roots: IdentityRoots, deviceDid: DID | DIDString): string;
export declare function loadLocalDeviceDocumentForRoots(roots: IdentityRoots, nodeIdentity: BuckyOSLocalNodeIdentityConfig, verify: boolean): Promise<[string, BuckyOSDeviceDocument]>;
export declare function saveNodeGatewayParams(etcDir: string, deviceDid: DID | DIDString): void;
export declare function saveLocalDeviceIdentityForRoots(etcDir: string, roots: IdentityRoots, nodeIdentity: BuckyOSLocalNodeIdentityConfig, deviceDoc: BuckyOSDeviceDocument, deviceDocJwt: string, deviceMiniDocJwt: string, devicePrivateKeyPem: string): DeviceIdentityPaths;
export declare function decodeDeviceDocumentWithoutVerify(deviceDocJwt: string): BuckyOSDeviceDocument;
//# sourceMappingURL=device_identity.d.ts.map