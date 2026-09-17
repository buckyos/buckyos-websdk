export declare const ACTIVATION_DEVICE_NAME = "ood1";
export declare const ACTIVATION_NET_ID = "wan";
export declare const ACTIVATION_DEFAULT_RTCP_PORT = 2980;
export declare const ACTIVATION_DOCUMENT_VALIDITY_SECONDS: number;
export declare const ACTIVATION_MIN_PASSWORD_LENGTH = 8;
export declare const ACTIVATION_LOCK_FILE_NAME = "provision_activation.lock";
export declare const ZONE_DNS_RECORDS_FILE_NAME = "zone_dns_records.json";
export declare const ZONE_DOCUMENT_JWT_FILE_NAME = "zone_document.jwt";
export type ActivationState = 'not_installed' | 'unactivated' | 'partial' | 'configured' | 'invalid';
export type ActivationFileRole = 'device_private_key' | 'device_document' | 'device_document_jwt' | 'device_mini_document_jwt' | 'zone_boot_override' | 'zone_document_jwt' | 'dns_records' | 'start_config' | 'gateway_params' | 'node_identity';
export type ActivationLockStage = 'locked' | 'backup_saved' | 'committing' | 'committed';
export interface ActivationProblem {
    code: string;
    message: string;
}
export interface ProvisionKeyPair {
    privateKeyPem: string;
    publicKeyX: string;
}
export interface ActivationDnsRecord {
    type: 'A' | 'AAAA';
    name: string;
    value: string;
}
export interface ActivationFileEntry {
    path: string;
    role: ActivationFileRole;
    required: boolean;
    secret: boolean;
}
export interface ObservedActivationFile extends ActivationFileEntry {
    present: boolean;
}
export interface CommittedActivationFile extends ActivationFileEntry {
    sha256: string | null;
}
export interface ActivationLockInfo {
    path: string;
    schemaVersion: number | null;
    traceId: string | null;
    startedAt: number | null;
    domain: string | null;
    stage: ActivationLockStage | null;
    committedFiles: string[];
    ownerKeyBackupPath: string | null;
    corrupt: boolean;
}
export interface ActivationStatus {
    rootDir: string;
    state: ActivationState;
    startupRequired: boolean;
    observedAt: number;
    zoneDid: string | null;
    ownerDid: string | null;
    deviceDid: string | null;
    deviceName: string | null;
    accessHostname: string | null;
    files: ObservedActivationFile[];
    problems: ActivationProblem[];
    warnings: string[];
    lock: ActivationLockInfo | null;
}
export interface OfflineActivationCheckOptions {
    rootDir: string;
    domain: string;
    ownerName: string;
    ownerKeyBackupPath: string;
    rtcpPort?: number;
    guestAccess?: boolean;
    publicIp?: string;
}
export interface OfflineActivationOptions extends OfflineActivationCheckOptions {
    adminPassword: string;
    ownerKeyPair?: ProvisionKeyPair;
    deviceKeyPair?: ProvisionKeyPair;
    traceId?: string;
}
export interface OwnerKeyBackupTarget {
    path: string;
    directoryExists: boolean;
    exists: boolean;
}
export interface OfflineActivationPrecheck {
    ready: boolean;
    rootDir: string;
    state: ActivationState;
    domain: string;
    ownerName: string;
    ownerDid: string;
    zoneDid: string;
    deviceDid: string;
    deviceName: string;
    accessHostname: string;
    rtcpPort: number;
    guestAccess: boolean;
    publicIp: string | null;
    dnsRecords: ActivationDnsRecord[];
    ownerKeyBackup: OwnerKeyBackupTarget;
    plannedFiles: ActivationFileEntry[];
    problems: ActivationProblem[];
    status: ActivationStatus;
}
export interface OfflineActivationResult {
    rootDir: string;
    state: 'configured';
    startupRequired: true;
    domain: string;
    ownerName: string;
    ownerDid: string;
    zoneDid: string;
    deviceDid: string;
    deviceName: string;
    accessHostname: string;
    rtcpPort: number;
    guestAccess: boolean;
    publicIp: string | null;
    documentIat: number;
    documentExp: number;
    ownerKeyBackup: {
        path: string;
        saved: true;
    };
    dnsRecords: ActivationDnsRecord[];
    committedFiles: CommittedActivationFile[];
    warnings: string[];
}
export interface ActivationErrorDetails {
    [key: string]: unknown;
}
export declare class ActivationError extends Error {
    readonly code: string;
    readonly details: ActivationErrorDetails;
    constructor(code: string, message: string, details?: ActivationErrorDetails);
}
export declare function validateZoneDomain(value: string): string;
export declare function validateOwnerName(value: string): string;
export declare function validateRtcpPort(value: number | undefined): number;
export declare function validatePublicIp(value: string | undefined): string | undefined;
export declare function validateAdminPassword(value: string): string;
export declare function hashAdminPassword(ownerName: string, password: string): string;
export declare function buildActivationDnsRecords(domain: string, publicIp?: string): ActivationDnsRecord[];
export declare function generateProvisionKeyPair(): ProvisionKeyPair;
export declare function inspectActivationRoot(rootDir: string): Promise<ActivationStatus>;
export declare function checkOfflineActivation(options: OfflineActivationCheckOptions): Promise<OfflineActivationPrecheck>;
export declare function activateOfflineZone(options: OfflineActivationOptions): Promise<OfflineActivationResult>;
//# sourceMappingURL=provision_activate.d.ts.map