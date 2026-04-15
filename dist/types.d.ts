export type DID = string;
export type JwkLike = Record<string, unknown>;
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
export interface W3CDIDDocumentBase {
    '@context': string;
    id: DID;
    verificationMethod: W3CVerificationMethod[];
    authentication: string[];
    assertionMethod?: string[];
    assertion_method?: string[];
    service?: W3CService[];
    exp: number;
    iat: number;
    [key: string]: unknown;
}
export type W3CDIDDocument = W3CDIDDocumentBase;
export interface BuckyOSOwnerConfigDocument extends W3CDIDDocumentBase {
    name: string;
    full_name: string;
    meta?: unknown;
    default_zone_did?: DID;
}
export interface BuckyOSDeviceMiniDocument {
    n: string;
    x?: string;
    p?: number;
    exp?: number;
    [key: string]: unknown;
}
export interface BuckyOSDeviceDocument extends W3CDIDDocumentBase {
    zone_did?: DID;
    owner: DID;
    device_type: string;
    device_mini_config_jwt?: string;
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
export interface BuckyOSZoneDocument extends W3CDIDDocumentBase {
    hostname: string;
    owner: DID;
    oods: unknown[];
    boot_jwt: string;
    devices?: Record<string, BuckyOSDeviceDocument>;
    sn?: string;
    docker_repo_base_url?: string;
    verify_hub_info?: Record<string, unknown>;
}
export type BuckyOSDIDDocument = BuckyOSOwnerConfigDocument | BuckyOSAgentDocument | BuckyOSDeviceDocument | BuckyOSZoneDocument;
export type VerificationMethodNode = W3CVerificationMethod;
export type ServiceNode = W3CService;
export type DIDDocumentBase = W3CDIDDocumentBase;
export type OwnerConfigDocument = BuckyOSOwnerConfigDocument;
export type UserDocument = BuckyOSOwnerConfigDocument;
export type DeviceMiniConfig = BuckyOSDeviceMiniDocument;
export type DeviceDocument = BuckyOSDeviceDocument;
export type AgentContactInfo = BuckyOSAgentContactInfo;
export type AgentHttpServicePorts = BuckyOSAgentHttpServicePorts;
export type AgentDocument = BuckyOSAgentDocument;
export type ZoneDocument = BuckyOSZoneDocument;
export declare function isW3CDIDDocumentBase(value: unknown): value is W3CDIDDocumentBase;
export declare function isBuckyOSOwnerConfigDocument(value: unknown): value is BuckyOSOwnerConfigDocument;
export declare function isUserDocument(value: unknown): value is UserDocument;
export declare function isBuckyOSDeviceMiniDocument(value: unknown): value is BuckyOSDeviceMiniDocument;
export declare function isBuckyOSDeviceDocument(value: unknown): value is BuckyOSDeviceDocument;
export declare function isBuckyOSAgentDocument(value: unknown): value is BuckyOSAgentDocument;
export declare function isBuckyOSZoneDocument(value: unknown): value is BuckyOSZoneDocument;
export declare function isDIDDocumentBase(value: unknown): value is DIDDocumentBase;
export declare function isOwnerConfigDocument(value: unknown): value is OwnerConfigDocument;
export declare function isDeviceMiniConfig(value: unknown): value is DeviceMiniConfig;
export declare function isDeviceDocument(value: unknown): value is DeviceDocument;
export declare function isAgentDocument(value: unknown): value is AgentDocument;
export declare function isZoneDocument(value: unknown): value is ZoneDocument;
export declare function parseW3CDIDDocumentBase(value: unknown): W3CDIDDocumentBase | null;
export declare function parseBuckyOSOwnerConfigDocument(value: unknown): BuckyOSOwnerConfigDocument | null;
export declare function parseOwnerConfigDocument(value: unknown): OwnerConfigDocument | null;
export declare function parseBuckyOSDeviceMiniDocument(value: unknown): BuckyOSDeviceMiniDocument | null;
export declare function parseDeviceMiniConfig(value: unknown): DeviceMiniConfig | null;
export declare function parseBuckyOSDIDDocument(value: unknown): BuckyOSDIDDocument | null;
export declare function getDidMethod(did: DID): string | null;
export declare function getDidIdentifier(did: DID): string | null;
//# sourceMappingURL=types.d.ts.map