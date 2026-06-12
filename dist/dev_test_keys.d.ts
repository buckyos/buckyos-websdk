export interface DevTestKeyPair {
    privateKeyPem: string;
    publicKeyX: string;
}
export declare const DEV_TEST_KEYS: Record<string, DevTestKeyPair>;
export declare function getDevTestKeyPairById(id: string): DevTestKeyPair;
//# sourceMappingURL=dev_test_keys.d.ts.map