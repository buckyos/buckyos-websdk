export type DID = string;
export type JwkLike = Record<string, unknown>;
export type DIDContext = string | string[];
export interface Ed25519Jwk {
    kty: string;
    crv: string;
    x: string;
    [key: string]: unknown;
}
export interface W3CVerificationMethod {
    type: string;
    id: string;
    controller: string;
    publicKeyJwk: JwkLike;
    [key: string]: unknown;
}
export interface W3CService {
    id: string;
    type: string;
    serviceEndpoint: string;
    [key: string]: unknown;
}
export type DidDocType = 'zone' | 'owner' | 'info' | 'boot' | 'user' | 'device' | 'did-object' | 'agent' | (string & {});
export interface W3CDIDDocumentBase {
    '@context': DIDContext;
    id: DID;
    verificationMethod: W3CVerificationMethod[];
    authentication: string[];
    assertionMethod?: string[];
    assertion_method?: string[];
    capabilityInvocation?: string[];
    service?: W3CService[];
    exp: number;
    iat: number;
    version_seq?: number;
    keyScope?: Record<string, string[]>;
    'buckyos:scopes'?: Record<string, string[]>;
    [key: string]: unknown;
}
export type W3CDIDDocument = W3CDIDDocumentBase;
export interface OwnerWallet {
    type: string;
    address: string;
}
export interface BuckyOSOwnerDocument extends W3CDIDDocumentBase {
    mini_version_seq?: number;
    valid_iat?: number;
    name: string;
    display_name: string;
    avatar?: string;
    meta?: unknown;
    binded_zone_list?: DID[];
    wallets?: Record<string, OwnerWallet>;
}
export interface BuckyOSDeviceMiniDocument {
    n: string;
    x: string;
    p?: number;
    exp: number;
    [key: string]: unknown;
}
export interface BuckyOSDeviceDocument extends W3CDIDDocumentBase {
    zone_did?: DID;
    owner: DID;
    device_type: string;
    device_mini_document_jwt?: string;
    name: string;
    rtcp_port?: number;
    ips?: string[];
    net_id?: string;
    ddns_sn_url?: string;
    support_container?: boolean;
    capbilities?: Record<string, number>;
}
export interface BuckyOSAgentContactInfo {
    telegram?: string;
    [key: string]: unknown;
}
export interface BuckyOSAgentHttpServicePorts {
    send_msg?: number;
    [key: string]: unknown;
}
export interface BuckyOSAgentDocument extends W3CDIDDocumentBase {
    support_public_access: boolean;
    contact: BuckyOSAgentContactInfo;
    owner: DID;
    eth_address?: string;
    public_description?: string;
    httpServicePorts: BuckyOSAgentHttpServicePorts;
}
export interface BuckyOSVerifyHubInfo {
    public_key: Ed25519Jwk;
}
export interface BuckyOSZoneDocument extends W3CDIDDocumentBase {
    hostname: string;
    owner: DID;
    oods: string[];
    boot_jwt: string;
    mini_device_jwts?: Record<string, string>;
    devices?: Record<string, BuckyOSDeviceDocument>;
    sn?: string;
}
export interface BuckyOSZoneConfig {
    zone_document: string;
    docker_repo_base_url?: string;
    verify_hub_info?: BuckyOSVerifyHubInfo;
}
export interface BuckyOSZoneBootDocument {
    id?: DID;
    oods: string[];
    sn?: string;
    exp: number;
    owner?: DID;
    owner_key?: Ed25519Jwk;
    [key: string]: unknown;
}
export declare const DID_OBJECT_SERVICE_TYPE = "DIDObjectService";
export declare const DID_OBJECT_SERVICE_ID = "#did-object";
export interface BuckyOSDIDObjectService {
    id: string;
    type: string;
    serviceEndpoint: string;
    profile: string;
    kind?: string;
    [key: string]: unknown;
}
export interface BuckyOSDIDObjectCard {
    '@context': DIDContext;
    id: DID;
    alsoKnownAs?: string[];
    controller?: DID;
    verificationMethod?: W3CVerificationMethod[];
    authentication?: string[];
    assertionMethod?: string[];
    capabilityInvocation?: string[];
    service?: BuckyOSDIDObjectService[];
    exp?: number;
    iat?: number;
    version_seq?: number;
    keyScope?: Record<string, string[]>;
    [key: string]: unknown;
}
export interface BuckyOSNodeIdentityConfig {
    zone_did: DID;
    owner_public_key: Ed25519Jwk;
    owner_did: DID;
    device_doc_jwt: string;
    device_mini_doc_jwt: string;
    zone_iat: number;
}
export declare const NODE_IDENTITY_SCHEMA_V2 = "buckyos.node_identity.v2";
export interface BuckyOSLocalNodeIdentityConfig {
    schema: string;
    zone_did: DID;
    owner_did: DID;
    owner_public_key: Ed25519Jwk;
    device_name: string;
    device_did: DID;
    zone_iat: number;
}
export interface BuckyOSZoneTxtRecord {
    boot_config_jwt: string;
    device_mini_doc_jwt: string;
    pkx: string;
}
export type BuckyOSDIDDocument = BuckyOSOwnerDocument | BuckyOSAgentDocument | BuckyOSDeviceDocument | BuckyOSZoneDocument | BuckyOSDIDObjectCard;
export declare function isW3CDIDDocumentBase(value: unknown): value is W3CDIDDocumentBase;
export declare function isBuckyOSOwnerDocument(value: unknown): value is BuckyOSOwnerDocument;
export declare function isBuckyOSDeviceMiniDocument(value: unknown): value is BuckyOSDeviceMiniDocument;
export declare function isBuckyOSZoneBootDocument(value: unknown): value is BuckyOSZoneBootDocument;
export declare function isBuckyOSNodeIdentityConfig(value: unknown): value is BuckyOSNodeIdentityConfig;
export declare function isBuckyOSLocalNodeIdentityConfig(value: unknown): value is BuckyOSLocalNodeIdentityConfig;
export declare function isBuckyOSDeviceDocument(value: unknown): value is BuckyOSDeviceDocument;
export declare function isBuckyOSAgentDocument(value: unknown): value is BuckyOSAgentDocument;
export declare function isBuckyOSZoneDocument(value: unknown): value is BuckyOSZoneDocument;
export declare function isBuckyOSDIDObjectCard(value: unknown): value is BuckyOSDIDObjectCard;
export declare function isBuckyOSZoneConfig(value: unknown): value is BuckyOSZoneConfig;
export declare function parseW3CDIDDocumentBase(value: unknown): W3CDIDDocumentBase | null;
export declare function parseBuckyOSOwnerDocument(value: unknown): BuckyOSOwnerDocument | null;
export declare function parseBuckyOSDeviceMiniDocument(value: unknown): BuckyOSDeviceMiniDocument | null;
export declare function parseBuckyOSDIDDocument(value: unknown): BuckyOSDIDDocument | null;
export declare function getDidMethod(did: DID): string | null;
export declare function getDidIdentifier(did: DID): string | null;
//# sourceMappingURL=types.d.ts.map