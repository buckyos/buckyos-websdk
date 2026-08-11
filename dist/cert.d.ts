export declare const IDENTITY_USAGES: readonly ["server", "client", "authentication", "assertion", "key-agreement", "capability"];
export type IdentityUsage = typeof IDENTITY_USAGES[number];
export declare const IDENTITY_MATERIALS: readonly ["did-json", "did-meta", "cert", "chain", "fullchain", "ca", "public", "csr", "meta", "private", "keyref", "verification-method"];
export type IdentityMaterial = typeof IDENTITY_MATERIALS[number];
export type IdentityMatchType = 'exact' | 'wildcard';
export interface IdentityRootsOptions {
    publicRoot?: string;
    securityRoot?: string;
    buckyosRoot?: string;
}
export interface X509Paths {
    cert: string;
    chain: string;
    fullchain: string;
    ca: string;
    metadata: string;
    keyref: string;
    privateKey: string;
}
export interface IdentityDirMatch {
    type: IdentityMatchType;
    rawHostUri: string;
    dirName: string;
    publicDir: string;
    securityDir: string;
    host?: string;
    hostPattern?: string;
}
export interface X509PathMatch {
    match: IdentityDirMatch;
    paths: X509Paths;
}
export interface CreateIdentityCertFromCaOptions {
    usage?: Extract<IdentityUsage, 'server' | 'client'>;
    hostnames?: string[];
    uriSans?: string[];
}
export interface CreateIdentityCertResult {
    did: string;
    rawHostUri: string;
    dirName: string;
    paths: X509Paths;
    certPath: string;
    chainPath: string;
    fullchainPath: string;
    caPath: string;
    keyPath: string;
    metadataPath: string;
}
export declare function encodeIdentityDirName(rawHostUri: string): string;
export declare function identityRawHostUri(didOrHostname: string): string;
export declare function identityDirName(didOrHostname: string): string;
export declare function didWebDocumentUrl(didOrHostname: string): string | null;
export declare function identityFileName(usage: IdentityUsage, material: IdentityMaterial): string;
export declare class IdentityRoots {
    publicRoot: string;
    securityRoot: string;
    constructor(publicRoot: string, securityRoot: string);
    static fromEnvOrBuckyosRoot(options?: IdentityRootsOptions): IdentityRoots;
    rawHostUri(didOrHostname: string): string;
    dirName(didOrHostname: string): string;
    publicDir(didOrHostname: string): string;
    securityDir(didOrHostname: string): string;
    publicFile(didOrHostname: string, usage: IdentityUsage, material: IdentityMaterial): string;
    securityFile(didOrHostname: string, usage: IdentityUsage, material: IdentityMaterial): string;
    x509Paths(didOrHostname: string, usage?: Extract<IdentityUsage, 'server' | 'client'>): X509Paths;
    identityDirMatch(didOrHostname: string): IdentityDirMatch;
    findX509Paths(didOrHostname: string, usage?: Extract<IdentityUsage, 'server' | 'client'>): X509PathMatch | null;
}
export interface CreateCaResult {
    caCertPath: string;
    caKeyPath: string;
}
export declare function createCa(outputDir: string, name?: string): Promise<CreateCaResult>;
export declare function ensureCa(caDir: string, name?: string): Promise<CreateCaResult>;
export interface CreateCertResult {
    certPath: string;
    keyPath: string;
}
export declare function createCertFromCa(caDir: string, hostname: string, targetDir: string, hostnames?: string[]): Promise<CreateCertResult>;
export declare function createIdentityCertFromCa(caDir: string, didOrHostname: string, rootsInput: IdentityRoots | IdentityRootsOptions, options?: CreateIdentityCertFromCaOptions): Promise<CreateIdentityCertResult>;
//# sourceMappingURL=cert.d.ts.map