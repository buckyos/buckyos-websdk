import { BuckyOSDeviceDocument, BuckyOSDeviceMiniDocument, BuckyOSNodeIdentityConfig, BuckyOSOwnerConfigDocument, BuckyOSZoneBootConfig, BuckyOSZoneDocument, DIDContext, Ed25519Jwk, DID as DIDString } from './types';
export declare const DID_CORE_CONTEXT = "https://www.w3.org/ns/did/v1";
export declare const BUCKYOS_CONTEXT_BASE = "https://buckyos.org/ns";
export declare const DID_DOC_AUTHKEY = "#auth-key";
export declare const DEFAULT_EXPIRE_TIME: number;
export declare function buckyosContext(docType: string): DIDContext;
export declare function buckyosGetUnixTimestamp(): number;
export declare function base64UrlEncodeBytes(bytes: Uint8Array): string;
export declare function base64UrlDecodeToBytes(value: string): Uint8Array;
export declare function base64UrlEncodeString(value: string): string;
export declare function base64UrlDecodeToString(value: string): string;
export declare function pemToDer(pem: string): Uint8Array;
export declare function derToPkcs8Pem(der: Uint8Array): string;
export interface Ed25519KeyPair {
    privateKeyPem: string;
    publicKeyJwk: Ed25519Jwk;
}
export declare function generateEd25519KeyPair(): Promise<Ed25519KeyPair>;
export declare function getPublicKeyXFromPrivatePem(privateKeyPem: string): Promise<string>;
export declare function getXFromJwk(jwk: Ed25519Jwk | Record<string, unknown>): string;
export declare function createJwkByX(x: string): Ed25519Jwk;
export declare function getDeviceDidFromJwk(jwk: Ed25519Jwk | Record<string, unknown>): string;
export declare function signJwtEdDSA(payload: unknown, privateKeyPem: string, header?: Record<string, unknown>): Promise<string>;
export declare function decodeJwtClaimWithoutVerify(jwt: string): any;
export declare function decodeJwtHeaderWithoutVerify(jwt: string): any;
export declare function verifyJwtEdDSA(jwt: string, publicKeyJwk: Ed25519Jwk): Promise<any>;
export type EncodedDocument = {
    type: 'json';
    value: any;
} | {
    type: 'jwt';
    jwt: string;
};
export declare function encodedDocumentFromStr(docStr: string): EncodedDocument;
export declare function encodedDocumentToJsonValue(doc: EncodedDocument): any;
export declare function encodedDocumentToString(doc: EncodedDocument): string;
export declare function setKnownWeb3BridgeConfig(config: Record<string, string>): boolean;
export declare function getKnownWeb3BridgeConfig(): Record<string, string> | null;
export declare function resetKnownWeb3BridgeConfigForTest(): void;
export declare class DID {
    method: string;
    id: string;
    constructor(method: string, id: string);
    static undefined(): DID;
    isUndefined(): boolean;
    isValid(): boolean;
    static isDid(did: string): boolean;
    static fromStr(did: string): DID;
    static fromHostName(hostName: string): DID | null;
    static fromHostNameByBridge(hostName: string, method: string, bridgeBaseHostname: string): DID;
    toString(): DIDString;
    getPathFromId(): string | null;
    getEd25519AuthKey(): Uint8Array | null;
    getAuthKeyJwk(): Ed25519Jwk | null;
    toRawHostName(): string;
    toRawHostUri(): string;
    toHostNameByBridge(bridgeBaseHostname: string): string;
    toHostName(): string;
    toHostUri(): string;
    equals(other: DID): boolean;
}
export type DeviceNodeType = 'OOD' | 'Gateway' | 'OODOnly' | 'Server' | 'Device' | 'Sensor' | 'IoTController';
export interface OODDescription {
    name: string;
    nodeType: DeviceNodeType;
    netId?: string;
    ip?: string;
}
export declare function parseOODDescription(s: string): OODDescription;
export declare function oodDescriptionToString(desc: OODDescription): string;
export declare function oodNodeTypeIsOod(nodeType: DeviceNodeType): boolean;
export declare function oodNodeTypeIsGateway(nodeType: DeviceNodeType): boolean;
export interface NewOwnerConfigParams {
    did: DID | DIDString;
    name: string;
    fullName: string;
    publicKeyJwk: Ed25519Jwk;
    now?: number;
}
export declare function newOwnerConfig(params: NewOwnerConfigParams): BuckyOSOwnerConfigDocument;
export declare function setOwnerDefaultZoneDid(ownerConfig: BuckyOSOwnerConfigDocument, defaultZoneDid: DID | DIDString): void;
export interface NewZoneConfigParams {
    id: DID | DIDString;
    ownerDid: DID | DIDString;
    publicKeyJwk: Ed25519Jwk;
    now?: number;
}
export declare function newZoneConfig(params: NewZoneConfigParams): BuckyOSZoneDocument;
export declare function zoneConfigInitByBootConfig(zoneConfig: BuckyOSZoneDocument, bootConfig: BuckyOSZoneBootConfig, bootJwt: string): void;
export interface NewZoneBootConfigParams {
    id?: DID | DIDString;
    oods: string[];
    sn?: string;
    exp: number;
    owner?: DID | DIDString;
    ownerKey?: Ed25519Jwk;
}
export declare function newZoneBootConfig(params: NewZoneBootConfigParams): BuckyOSZoneBootConfig;
export declare function encodeZoneBootConfig(bootConfig: BuckyOSZoneBootConfig, ownerPrivateKeyPem: string): Promise<string>;
export declare function decodeZoneBootConfig(jwt: string, publicKeyJwk?: Ed25519Jwk): Promise<BuckyOSZoneBootConfig>;
export declare function zoneBootConfigToZoneConfig(bootConfig: BuckyOSZoneBootConfig, bootJwt: string): BuckyOSZoneDocument;
export interface NewDeviceConfigParams {
    name: string;
    pkx: string;
    now?: number;
}
export declare function newDeviceConfig(params: NewDeviceConfigParams): BuckyOSDeviceDocument;
export declare function newDeviceConfigByJwk(name: string, publicKeyJwk: Ed25519Jwk, now?: number): BuckyOSDeviceDocument;
export declare function newDeviceConfigByMiniConfig(miniConfigJwt: string, miniConfig: BuckyOSDeviceMiniDocument, zoneDid: DID | DIDString, ownerDid: DID | DIDString): BuckyOSDeviceDocument;
export declare function encodeDeviceConfig(deviceConfig: BuckyOSDeviceDocument, ownerPrivateKeyPem: string): Promise<string>;
export declare function decodeDeviceConfig(jwt: string, publicKeyJwk?: Ed25519Jwk): Promise<BuckyOSDeviceDocument>;
export interface NewDeviceMiniConfigParams {
    name: string;
    x: string;
    rtcpPort?: number;
    exp: number;
}
export declare function newDeviceMiniConfig(params: NewDeviceMiniConfigParams): BuckyOSDeviceMiniDocument;
export declare function newDeviceMiniConfigByDeviceConfig(deviceConfig: BuckyOSDeviceDocument): BuckyOSDeviceMiniDocument;
export declare function deviceMiniConfigToJwt(miniConfig: BuckyOSDeviceMiniDocument, ownerPrivateKeyPem: string): Promise<string>;
export declare function deviceMiniConfigFromJwt(jwt: string, publicKeyJwk?: Ed25519Jwk): Promise<BuckyOSDeviceMiniDocument>;
export interface NewNodeIdentityConfigParams {
    zoneDid: DID | DIDString;
    ownerPublicKey: Ed25519Jwk;
    ownerDid: DID | DIDString;
    deviceDocJwt: string;
    deviceMiniDocJwt: string;
    zoneIat: number;
}
export declare function newNodeIdentityConfig(params: NewNodeIdentityConfigParams): BuckyOSNodeIdentityConfig;
export declare function encodeOwnerConfig(ownerConfig: BuckyOSOwnerConfigDocument, privateKeyPem: string): Promise<string>;
export declare function encodeZoneConfig(zoneConfig: BuckyOSZoneDocument, ownerPrivateKeyPem: string): Promise<string>;
//# sourceMappingURL=namelib.d.ts.map