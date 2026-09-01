import { BuckyOSAgentDocument, BuckyOSDeviceDocument, BuckyOSDeviceMiniDocument, BuckyOSDIDDocument, BuckyOSDIDObjectCard, BuckyOSNodeIdentityConfig, BuckyOSOwnerDocument, BuckyOSZoneBootDocument, BuckyOSZoneDocument, DidDocType, DIDContext, Ed25519Jwk, W3CDIDDocumentBase, DID as DIDString } from './types';
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
    isNamedObjId(): boolean;
    getPathFromId(): string | null;
    upperDid(): DID | null;
    toFilename(): string;
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
export declare const ZONE_BINDING_MODEL_VERSION: 2;
export type OwnerDocumentZoneBindingState = 'legacy' | 'bound_v2' | 'unbound_v2' | 'unsupported_version';
export interface NewOwnerDocumentParams {
    did: DID | DIDString;
    name: string;
    displayName: string;
    publicKeyJwk: Ed25519Jwk;
    now?: number;
}
export declare function newOwnerDocument(params: NewOwnerDocumentParams): BuckyOSOwnerDocument;
export declare function newOwnerDocumentByPkx(pkx: string, hostname: string): BuckyOSOwnerDocument;
export declare function ownerDocumentSetDefaultZoneDid(ownerDoc: BuckyOSOwnerDocument, defaultZoneDid: DID | DIDString): void;
export declare function ownerDocumentRemoveBoundZone(ownerDoc: BuckyOSOwnerDocument, zoneDid: DID | DIDString): boolean;
export declare function ownerDocumentGetDefaultZoneDid(ownerDoc: BuckyOSOwnerDocument): DIDString | null;
export declare function ownerDocumentIsBoundToZone(ownerDoc: BuckyOSOwnerDocument, zoneDid: DID | DIDString): boolean;
export declare function ownerDocumentGetZoneBindingState(ownerDoc: BuckyOSOwnerDocument, zoneDid: DID | DIDString): OwnerDocumentZoneBindingState;
export declare function ownerDocumentGetHistoricalKeys(ownerDoc: BuckyOSOwnerDocument): Array<[string, Ed25519Jwk]>;
export declare function ownerDocumentValidateJwtRevocation(ownerDoc: BuckyOSOwnerDocument, docType: string, doc: EncodedDocument): void;
export interface NewZoneDocumentParams {
    id: DID | DIDString;
    ownerDid: DID | DIDString;
    publicKeyJwk: Ed25519Jwk;
    now?: number;
}
export declare function newZoneDocument(params: NewZoneDocumentParams): BuckyOSZoneDocument;
export declare function zoneDocumentGetDefaultGateway(zoneDoc: BuckyOSZoneDocument): string | null;
export declare function zoneDocumentGetSnApiUrl(zoneDoc: BuckyOSZoneDocument): string | null;
export interface NewZoneBootDocumentParams {
    id?: DID | DIDString;
    oods: string[];
    sn?: string;
    exp: number;
    owner?: DID | DIDString;
    ownerKey?: Ed25519Jwk;
}
export declare function newZoneBootDocument(params: NewZoneBootDocumentParams): BuckyOSZoneBootDocument;
export declare function encodeZoneBootDocument(bootDoc: BuckyOSZoneBootDocument, ownerPrivateKeyPem: string): Promise<string>;
export declare function decodeZoneBootDocument(jwt: string, publicKeyJwk?: Ed25519Jwk): Promise<BuckyOSZoneBootDocument>;
export declare function zoneBootDocumentGetGatewayName(bootDoc: BuckyOSZoneBootDocument): string;
export declare function zoneBootDocumentToZoneDocument(bootDoc: BuckyOSZoneBootDocument, bootJwt: string): BuckyOSZoneDocument;
export interface NewDeviceDocumentParams {
    name: string;
    pkx: string;
    now?: number;
}
export declare function newDeviceDocument(params: NewDeviceDocumentParams): BuckyOSDeviceDocument;
export declare function newDeviceDocumentByJwk(name: string, publicKeyJwk: Ed25519Jwk, now?: number): BuckyOSDeviceDocument;
export declare function newDeviceDocumentByMiniDocument(miniDocJwt: string, miniDoc: BuckyOSDeviceMiniDocument, zoneDid: DID | DIDString, ownerDid: DID | DIDString): BuckyOSDeviceDocument;
export declare function encodeDeviceDocument(deviceDoc: BuckyOSDeviceDocument, ownerPrivateKeyPem: string): Promise<string>;
export declare function decodeDeviceDocument(jwt: string, publicKeyJwk?: Ed25519Jwk): Promise<BuckyOSDeviceDocument>;
export interface NewDeviceMiniDocumentParams {
    name: string;
    x: string;
    rtcpPort?: number;
    exp: number;
}
export declare function newDeviceMiniDocument(params: NewDeviceMiniDocumentParams): BuckyOSDeviceMiniDocument;
export declare function newDeviceMiniDocumentByDeviceDocument(deviceDoc: BuckyOSDeviceDocument): BuckyOSDeviceMiniDocument;
export declare function deviceMiniDocumentToJwt(miniDoc: BuckyOSDeviceMiniDocument, ownerPrivateKeyPem: string): Promise<string>;
export declare function deviceMiniDocumentFromJwt(jwt: string, publicKeyJwk?: Ed25519Jwk): Promise<BuckyOSDeviceMiniDocument>;
export interface NewNodeIdentityConfigParams {
    zoneDid: DID | DIDString;
    ownerPublicKey: Ed25519Jwk;
    ownerDid: DID | DIDString;
    deviceDocJwt: string;
    deviceMiniDocJwt: string;
    zoneIat: number;
}
export declare function newNodeIdentityConfig(params: NewNodeIdentityConfigParams): BuckyOSNodeIdentityConfig;
export declare function encodeOwnerDocument(ownerDoc: BuckyOSOwnerDocument, privateKeyPem: string): Promise<string>;
export declare function encodeZoneDocument(zoneDoc: BuckyOSZoneDocument, ownerPrivateKeyPem: string): Promise<string>;
export declare function ownerDocumentToOrderedJson(doc: BuckyOSOwnerDocument): Record<string, unknown>;
export declare function zoneDocumentToOrderedJson(doc: BuckyOSZoneDocument): Record<string, unknown>;
export declare function deviceDocumentToOrderedJson(doc: BuckyOSDeviceDocument): Record<string, unknown>;
export declare const KEY_SCOPE_MANUAL = "manual";
export declare const KEY_SCOPE_ZONE_PUBLISH = "zone:publish";
export declare const KEY_SCOPE_MESSAGE_CREATE = "message:create";
export declare const KEY_SCOPE_CONTENT_CREATE = "content:create";
export declare const KEY_SCOPE_AGENT_SPEND = "agent:spend";
export declare const KEY_SCOPE_AGENT_RECEIVE = "agent:receive";
export declare const KEY_SCOPE_AGENT_CREATE_CONTENT = "agent:create-content";
export type AnyBuckyOSDIDDocument = W3CDIDDocumentBase | BuckyOSDIDObjectCard;
export declare function getDocumentKeyScope(doc: AnyBuckyOSDIDDocument): Record<string, string[]>;
export declare function getDocumentAuthKey(doc: AnyBuckyOSDIDDocument, kid?: string): Ed25519Jwk | null;
export declare function getDocumentDefaultKey(doc: AnyBuckyOSDIDDocument): Ed25519Jwk | null;
export declare function getKeyIdsByScope(doc: AnyBuckyOSDIDDocument, scope: string): string[] | null;
export declare function hasKeyScope(doc: AnyBuckyOSDIDDocument): boolean;
export declare function getStandardScopeKeyIds(doc: AnyBuckyOSDIDDocument): string[] | null;
export declare function normalizeKeyIdForLocalLookup(doc: AnyBuckyOSDIDDocument, keyId: string): string;
export declare function expandLocalKeyId(doc: AnyBuckyOSDIDDocument, keyId: string): string;
export declare function isSameDocumentKeyId(doc: AnyBuckyOSDIDDocument, left: string, right: string): boolean;
export declare function getKeyFromKeyIds(doc: AnyBuckyOSDIDDocument, keyIds: string[]): [string, Ed25519Jwk] | null;
export declare function getKeyByScope(doc: AnyBuckyOSDIDDocument, scope: string): [string, Ed25519Jwk] | null;
export declare function isKeyAllowedInScope(doc: AnyBuckyOSDIDDocument, scope: string, keyId: string): boolean;
export type ParsedDidDocument = {
    docType: 'owner';
    doc: BuckyOSOwnerDocument;
} | {
    docType: 'agent';
    doc: BuckyOSAgentDocument;
} | {
    docType: 'device';
    doc: BuckyOSDeviceDocument;
} | {
    docType: 'zone';
    doc: BuckyOSZoneDocument;
} | {
    docType: 'did-object';
    doc: BuckyOSDIDObjectCard;
};
export declare function parseDidDoc(doc: EncodedDocument | string): ParsedDidDocument;
export declare function getDidDocType(parsed: ParsedDidDocument): DidDocType;
export declare function parseDidDocAs<T extends BuckyOSDIDDocument>(doc: EncodedDocument | string, docType: ParsedDidDocument['docType']): T;
//# sourceMappingURL=namelib.d.ts.map