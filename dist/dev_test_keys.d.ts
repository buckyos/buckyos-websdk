/// <reference types="node" />
/// <reference types="node" />
import { Buffer } from 'node:buffer';
export declare const DEV_TEST_MNEMONIC = "test test test test test test test test test test test junk";
export declare const DEV_TEST_EVM_SEED_SENDER_INDEX = 0;
export interface DevTestKeyPair {
    privateKeyPem: string;
    publicKeyX: string;
}
export interface DevTestEvmAccount {
    derivationPath: string;
    privateKey: string;
    privateKeyHex: string;
    publicKeyCompressedHex: string;
    publicKeyUncompressedHex: string;
    address: string;
}
export declare function deriveDevTestKeyPairFromMnemonic(mnemonic: string, passphrase: string | undefined, index: number): DevTestKeyPair;
export declare function deriveDevTestKeyPair(index: number): DevTestKeyPair;
export declare function devTestKeccak256(data: Buffer): Buffer;
export declare function deriveDevTestEvmAccountFromMnemonic(mnemonic: string, passphrase: string | undefined, index: number): DevTestEvmAccount;
export declare function deriveDevTestEvmAccount(index: number): DevTestEvmAccount;
export declare const DEV_TEST_KEY_INDEXES: Record<string, number>;
export declare const DEV_TEST_EVM_USER_INDEXES: Record<string, number>;
export declare const DEV_TEST_KEYS: Record<string, DevTestKeyPair>;
export declare const DEV_TEST_EVM_ACCOUNTS: Record<string, DevTestEvmAccount>;
export declare const DEV_TEST_EVM_SEED_SENDER: DevTestEvmAccount;
export declare function getDevTestKeyPairByIndex(index: number): DevTestKeyPair;
export declare function getDevTestKeyPairById(id: string): DevTestKeyPair;
export declare function getDevTestEvmAccountByIndex(index: number): DevTestEvmAccount;
export declare function getDevTestEvmAccountByUsername(username: string): DevTestEvmAccount;
//# sourceMappingURL=dev_test_keys.d.ts.map