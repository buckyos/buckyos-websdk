import { Buffer } from 'node:buffer'
import {
  createECDH,
  createHmac,
  createPrivateKey,
  createPublicKey,
  pbkdf2Sync,
} from 'node:crypto'

// DEV-ONLY deterministic keys derived from the public Anvil mnemonic. The same
// mnemonic backs both Bucky Ed25519 keys and EVM accounts, matching Rust
// name-lib mnemonic derivation. NEVER use these in a production activation flow.

export const DEV_TEST_MNEMONIC = 'test test test test test test test test test test test junk'
export const DEV_TEST_EVM_SEED_SENDER_INDEX = 0

const HARDENED_OFFSET = 0x80000000
const BUC_KEY_PURPOSE = 9777
const BUC_KEY_COIN = 0
const SECP256K1_N = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141')
const MASK_64 = (1n << 64n) - 1n

const KECCAK_ROUNDS = [
  0x0000000000000001n,
  0x0000000000008082n,
  0x800000000000808an,
  0x8000000080008000n,
  0x000000000000808bn,
  0x0000000080000001n,
  0x8000000080008081n,
  0x8000000000008009n,
  0x000000000000008an,
  0x0000000000000088n,
  0x0000000080008009n,
  0x000000008000000an,
  0x000000008000808bn,
  0x800000000000008bn,
  0x8000000000008089n,
  0x8000000000008003n,
  0x8000000000008002n,
  0x8000000000000080n,
  0x000000000000800an,
  0x800000008000000an,
  0x8000000080008081n,
  0x8000000000008080n,
  0x0000000080000001n,
  0x8000000080008008n,
]

const KECCAK_ROTATION = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
]

export interface DevTestKeyPair {
  privateKeyPem: string
  publicKeyX: string
}

export interface DevTestEvmAccount {
  derivationPath: string
  privateKey: string
  privateKeyHex: string
  publicKeyCompressedHex: string
  publicKeyUncompressedHex: string
  address: string
}

function mnemonicToSeed(mnemonic: string, passphrase = ''): Buffer {
  return pbkdf2Sync(
    Buffer.from(mnemonic.normalize('NFKD'), 'utf8'),
    Buffer.from(`mnemonic${passphrase}`.normalize('NFKD'), 'utf8'),
    2048,
    64,
    'sha512',
  )
}

function hmacSha512(key: Buffer | string, data: Buffer): Buffer {
  return createHmac('sha512', key).update(data).digest()
}

function ser32(value: number): Buffer {
  const out = Buffer.alloc(4)
  out.writeUInt32BE(value >>> 0, 0)
  return out
}

function pkcs8PemFromEd25519Seed(seed: Buffer): string {
  const pkcs8 = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    seed,
  ])
  return `-----BEGIN PRIVATE KEY-----\n${pkcs8.toString('base64')}\n-----END PRIVATE KEY-----\n`
}

function getEd25519PublicKeyX(privateKeyPem: string): string {
  const jwk = createPublicKey(createPrivateKey(privateKeyPem)).export({
    format: 'jwk',
  }) as { x?: string }
  if (!jwk.x) {
    throw new Error('failed to derive Ed25519 public key x')
  }
  return jwk.x
}

function slip10MasterKey(seed: Buffer): { key: Buffer; chainCode: Buffer } {
  const result = hmacSha512('ed25519 seed', seed)
  return {
    key: result.subarray(0, 32),
    chainCode: result.subarray(32),
  }
}

function slip10DeriveHardened(
  parentKey: Buffer,
  parentChainCode: Buffer,
  index: number,
): { key: Buffer; chainCode: Buffer } {
  const data = Buffer.concat([
    Buffer.from([0]),
    parentKey,
    ser32(index + HARDENED_OFFSET),
  ])
  const result = hmacSha512(parentChainCode, data)
  return {
    key: result.subarray(0, 32),
    chainCode: result.subarray(32),
  }
}

function deriveBuckyEd25519Seed(mnemonic: string, passphrase: string, index: number): Buffer {
  let node = slip10MasterKey(mnemonicToSeed(mnemonic, passphrase))
  for (const segment of [BUC_KEY_PURPOSE, BUC_KEY_COIN, index]) {
    node = slip10DeriveHardened(node.key, node.chainCode, segment)
  }
  return Buffer.from(node.key)
}

export function deriveDevTestKeyPairFromMnemonic(
  mnemonic: string,
  passphrase: string | undefined,
  index: number,
): DevTestKeyPair {
  const seed = deriveBuckyEd25519Seed(mnemonic, passphrase ?? '', index)
  const privateKeyPem = pkcs8PemFromEd25519Seed(seed)
  return {
    privateKeyPem,
    publicKeyX: getEd25519PublicKeyX(privateKeyPem),
  }
}

export function deriveDevTestKeyPair(index: number): DevTestKeyPair {
  return deriveDevTestKeyPairFromMnemonic(DEV_TEST_MNEMONIC, undefined, index)
}

function bigintTo32(value: bigint): Buffer {
  const hex = value.toString(16).padStart(64, '0')
  return Buffer.from(hex, 'hex')
}

function bufferToBigint(value: Buffer): bigint {
  return BigInt(`0x${value.toString('hex')}`)
}

function secp256k1PublicKey(privateKey: Buffer, compressed: boolean): Buffer {
  const ecdh = createECDH('secp256k1')
  ecdh.setPrivateKey(privateKey)
  return ecdh.getPublicKey(undefined, compressed ? 'compressed' : 'uncompressed')
}

function secp256k1MasterKey(seed: Buffer): { privateKey: Buffer; chainCode: Buffer } {
  const result = hmacSha512('Bitcoin seed', seed)
  const privateKey = result.subarray(0, 32)
  const privateKeyInt = bufferToBigint(privateKey)
  if (privateKeyInt <= 0n || privateKeyInt >= SECP256K1_N) {
    throw new Error('invalid secp256k1 master key')
  }
  return {
    privateKey: Buffer.from(privateKey),
    chainCode: result.subarray(32),
  }
}

function secp256k1ChildKey(
  parentPrivateKey: Buffer,
  parentChainCode: Buffer,
  index: number,
): { privateKey: Buffer; chainCode: Buffer } {
  const hardened = index >= HARDENED_OFFSET
  const data = hardened
    ? Buffer.concat([Buffer.from([0]), parentPrivateKey, ser32(index)])
    : Buffer.concat([secp256k1PublicKey(parentPrivateKey, true), ser32(index)])
  const result = hmacSha512(parentChainCode, data)
  const tweak = bufferToBigint(result.subarray(0, 32))
  if (tweak >= SECP256K1_N) {
    throw new Error(`invalid secp256k1 child tweak at index ${index}`)
  }
  const childPrivateKeyInt = (tweak + bufferToBigint(parentPrivateKey)) % SECP256K1_N
  if (childPrivateKeyInt === 0n) {
    throw new Error(`invalid secp256k1 child key at index ${index}`)
  }
  return {
    privateKey: bigintTo32(childPrivateKeyInt),
    chainCode: result.subarray(32),
  }
}

function evmDerivationPath(index: number): number[] {
  return [
    44 + HARDENED_OFFSET,
    60 + HARDENED_OFFSET,
    HARDENED_OFFSET,
    0,
    index,
  ]
}

function evmDerivationPathString(index: number): string {
  return `m/44'/60'/0'/0/${index}`
}

function rotl64(value: bigint, shift: number): bigint {
  if (shift === 0) {
    return value & MASK_64
  }
  const n = BigInt(shift)
  return ((value << n) | (value >> (64n - n))) & MASK_64
}

function keccakF1600(state: bigint[]): void {
  for (const round of KECCAK_ROUNDS) {
    const c = new Array<bigint>(5)
    const d = new Array<bigint>(5)
    const b = new Array<bigint>(25).fill(0n)

    for (let x = 0; x < 5; x += 1) {
      c[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20]
    }
    for (let x = 0; x < 5; x += 1) {
      d[x] = c[(x + 4) % 5] ^ rotl64(c[(x + 1) % 5], 1)
    }
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        state[x + 5 * y] = (state[x + 5 * y] ^ d[x]) & MASK_64
      }
    }

    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl64(
          state[x + 5 * y],
          KECCAK_ROTATION[x][y],
        )
      }
    }
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        state[x + 5 * y] = (
          b[x + 5 * y] ^
          ((~b[((x + 1) % 5) + 5 * y] & MASK_64) & b[((x + 2) % 5) + 5 * y])
        ) & MASK_64
      }
    }
    state[0] = (state[0] ^ round) & MASK_64
  }
}

export function devTestKeccak256(data: Buffer): Buffer {
  const rate = 136
  const state = new Array<bigint>(25).fill(0n)
  const padded = Buffer.concat([
    data,
    Buffer.from([0x01]),
    Buffer.alloc((rate - ((data.length + 1) % rate)) % rate),
  ])
  padded[padded.length - 1] ^= 0x80

  for (let offset = 0; offset < padded.length; offset += rate) {
    for (let i = 0; i < rate; i += 1) {
      state[Math.floor(i / 8)] ^= BigInt(padded[offset + i]) << BigInt((i % 8) * 8)
    }
    keccakF1600(state)
  }

  const out = Buffer.alloc(32)
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number((state[Math.floor(i / 8)] >> BigInt((i % 8) * 8)) & 0xffn)
  }
  return out
}

function eip55Address(addr20: Buffer): string {
  const lowerHex = addr20.toString('hex')
  const hash = devTestKeccak256(Buffer.from(lowerHex, 'ascii'))
  let out = '0x'
  for (let i = 0; i < lowerHex.length; i += 1) {
    const ch = lowerHex[i]
    const nibble = (hash[Math.floor(i / 2)] >> (4 * (1 - (i % 2)))) & 0x0f
    out += /[a-f]/.test(ch) && nibble > 7 ? ch.toUpperCase() : ch
  }
  return out
}

export function deriveDevTestEvmAccountFromMnemonic(
  mnemonic: string,
  passphrase: string | undefined,
  index: number,
): DevTestEvmAccount {
  let node = secp256k1MasterKey(mnemonicToSeed(mnemonic, passphrase ?? ''))
  for (const segment of evmDerivationPath(index)) {
    node = secp256k1ChildKey(node.privateKey, node.chainCode, segment)
  }
  const uncompressed = secp256k1PublicKey(node.privateKey, false)
  const compressed = secp256k1PublicKey(node.privateKey, true)
  const addressHash = devTestKeccak256(uncompressed.subarray(1))
  const privateKeyHex = node.privateKey.toString('hex')
  return {
    derivationPath: evmDerivationPathString(index),
    privateKey: `0x${privateKeyHex}`,
    privateKeyHex,
    publicKeyCompressedHex: compressed.toString('hex'),
    publicKeyUncompressedHex: uncompressed.toString('hex'),
    address: eip55Address(addressHash.subarray(12)),
  }
}

export function deriveDevTestEvmAccount(index: number): DevTestEvmAccount {
  return deriveDevTestEvmAccountFromMnemonic(DEV_TEST_MNEMONIC, undefined, index)
}

export const DEV_TEST_KEY_INDEXES: Record<string, number> = {
  devtest: 0,
  alice: 1,
  bob: 2,
  charlie: 3,
  dave: 4,

  sn_owner: 5,
  devtests: 5,

  'devtest.ood1': 100,
  devtest_ood1: 100,
  'devtest.node1': 101,
  devtest_node1: 101,
  'alice.ood1': 102,
  alice_ood1: 102,
  'bob.ood1': 103,
  bob_ood1: 103,
  'charlie.ood1': 104,
  charlie_ood1: 104,
  'dave.ood1': 105,
  dave_ood1: 105,
  sn: 106,
  sn_server: 106,
  'devtests.ood1': 107,
  devtests_ood1: 107,
  sn_web: 107,
}

export const DEV_TEST_EVM_USER_INDEXES: Record<string, number> = {
  alice: 1,
  bob: 2,
  charlie: 3,
  dave: 4,
}

export const DEV_TEST_KEYS: Record<string, DevTestKeyPair> = Object.fromEntries(
  Object.entries(DEV_TEST_KEY_INDEXES).map(([id, index]) => [id, deriveDevTestKeyPair(index)]),
)

export const DEV_TEST_EVM_ACCOUNTS: Record<string, DevTestEvmAccount> = Object.fromEntries(
  Object.entries(DEV_TEST_EVM_USER_INDEXES).map(([username, index]) => [
    username,
    deriveDevTestEvmAccount(index),
  ]),
)

export const DEV_TEST_EVM_SEED_SENDER = deriveDevTestEvmAccount(DEV_TEST_EVM_SEED_SENDER_INDEX)

export function getDevTestKeyPairByIndex(index: number): DevTestKeyPair {
  return deriveDevTestKeyPair(index)
}

export function getDevTestKeyPairById(id: string): DevTestKeyPair {
  const keyPair = DEV_TEST_KEYS[id]
  if (!keyPair) {
    throw new Error(`unknown dev test key pair id: ${id}`)
  }
  return keyPair
}

export function getDevTestEvmAccountByIndex(index: number): DevTestEvmAccount {
  return deriveDevTestEvmAccount(index)
}

export function getDevTestEvmAccountByUsername(username: string): DevTestEvmAccount {
  const account = DEV_TEST_EVM_ACCOUNTS[username]
  if (!account) {
    throw new Error(`no deterministic EVM account for seed user ${username}; register it in DEV_TEST_EVM_USER_INDEXES`)
  }
  return account
}
