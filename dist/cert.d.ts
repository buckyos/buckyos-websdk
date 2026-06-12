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
//# sourceMappingURL=cert.d.ts.map