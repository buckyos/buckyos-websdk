// DEV-ONLY preset key pairs, ported verbatim from
// buckyos/src/kernel/buckyos-api/src/test_config.rs (TestKeys).
//
// These keys are public knowledge and exist purely for local dev/test
// environment construction (make_config and friends). NEVER use them in a
// production activation flow.

export interface DevTestKeyPair {
  privateKeyPem: string
  publicKeyX: string
}

function keyPair(privateKeyBase64: string, publicKeyX: string): DevTestKeyPair {
  return {
    privateKeyPem: `-----BEGIN PRIVATE KEY-----\n${privateKeyBase64}\n-----END PRIVATE KEY-----`,
    publicKeyX,
  }
}

const DEVTEST_OWNER = keyPair(
  'MC4CAQAwBQYDK2VwBCIEIJBRONAzbwpIOwm0ugIQNyZJrDXxZF7HoPWAZesMedOr',
  'T4Quc1L6Ogu4N2tTKOvneV1yYnBcmhP89B_RsuFsJZ8',
)
const DEVTEST_OOD1 = keyPair(
  'MC4CAQAwBQYDK2VwBCIEIMDp9endjUnT2o4ImedpgvhVFyZEunZqG+ca0mka8oRp',
  'gubVIszw-u_d5PVTh-oc8CKAhM9C-ne5G_yUK5BDaXc',
)
const DEVTEST_NODE1 = keyPair(
  'MC4CAQAwBQYDK2VwBCIEICwMZt1W7P/9v3Iw/rS2RdziVkF7L+o5mIt/WL6ef/0w',
  'Bb325f2ed0XSxrPS5sKQaX7ylY9Jh9rfevXiidKA1zc',
)
const BOB_OWNER = keyPair(
  'MC4CAQAwBQYDK2VwBCIEILQLoUZt2okCht0UVhsf4UlGAV9h3BoliwZQN5zBO1G+',
  'y-kuJcQ0doFpdNXf4HI8E814lK8MB3-t4XjDRcR_QCU',
)
const BOB_OOD1 = keyPair(
  'MC4CAQAwBQYDK2VwBCIEIADmO0+u/gcmStDsHZOZCM5gxNYlQmP6jpMo279TQE75',
  'iSMKakFEGzGAxLTlaB5TkqZ6d4wurObr-BpaQleoE2M',
)
// did:bns:devtests
const SN_OWNER = keyPair(
  'MC4CAQAwBQYDK2VwBCIEIMkwWZKUe7+z7NtfgbgxWwGjMddvxtrmeGJiJe8rq00M',
  'blzinUlTNGYcvCPFT1OfPKPbmjvteuXWMwQG55cTo7M',
)
const SN_SERVER = keyPair(
  'MC4CAQAwBQYDK2VwBCIEIBvnIIa1Tx45SjRu9kBZuMgusP5q762SvojXZ4scFxVD',
  'FPvY3WXPxuWPYFuwOY0Qbh0O7-hhKr6ta1jTcX9ORPI',
)
const DEVTESTS_OOD1 = keyPair(
  'MC4CAQAwBQYDK2VwBCIEICBO4nQL1yMcu4uu51Grea+VTaaS+sswioMRZXoltzZh',
  'waupPnLqJRwjr3hJ_2i2J4qGLx-8t5ihX6LET0ZY828',
)
// did:bns:alice
const ALICE_OWNER = keyPair(
  'MC4CAQAwBQYDK2VwBCIEIKH6oJdebg+xxICY7Z1vm84qMkSzm6Wk0ic88DGR90aq',
  'uh7RD37tflN65CrcJSUQ3vGnyU4vmC7_M8IkEEOHnds',
)
const ALICE_OOD1 = keyPair(
  'MC4CAQAwBQYDK2VwBCIEIGhyUJ3/YgIrLZxSGG7o1bgiWcyETZKjTBoGagNdpxVy',
  'E1oQDYqzyX4ysrNgTJ5DAVaMgA3By8XpBa0e6r2gBqQ',
)
const CHARLIE_OWNER = keyPair(
  'MC4CAQAwBQYDK2VwBCIEICLjVTK81RKQ1aPtSLKFx/Fl33+WbxgqCpPCBFlqlBQX',
  'cuFY7qeU1q96O1K5RRbXo7GXGR78szB-gmmkBXDMscE',
)
const CHARLIE_OOD1 = keyPair(
  'MC4CAQAwBQYDK2VwBCIEIMe0Q/tl7DWbu3SIQE8vnDxO8YQMIivAlCgKiNUfjcWU',
  'PY9uu16H74QYVRjstVxdWdAsgkoy10-74fvQhx4ddek',
)

// Key id -> key pair, aligned with TestKeys::get_key_pair_by_id in Rust.
export const DEV_TEST_KEYS: Record<string, DevTestKeyPair> = {
  // zone-id did:web:test.buckyos.io
  devtest: DEVTEST_OWNER,
  devtest_ood1: DEVTEST_OOD1,
  'devtest.ood1': DEVTEST_OOD1,
  devtest_node1: DEVTEST_NODE1,
  'devtest.node1': DEVTEST_NODE1,

  sn_owner: SN_OWNER,
  // zone-id did:web:devtests.org
  devtests: SN_OWNER,
  // zone-id None (sn is not a zone)
  sn: SN_SERVER,
  sn_server: SN_SERVER,
  devtests_ood1: DEVTESTS_OOD1,
  'devtests.ood1': DEVTESTS_OOD1,
  sn_web: DEVTESTS_OOD1,

  // zone-id did:bns:bob
  bob: BOB_OWNER,
  bob_ood1: BOB_OOD1,
  'bob.ood1': BOB_OOD1,

  // zone-id did:bns:alice
  alice: ALICE_OWNER,
  alice_ood1: ALICE_OOD1,
  'alice.ood1': ALICE_OOD1,

  // zone-id did:web:charlie.me
  charlie: CHARLIE_OWNER,
  charlie_ood1: CHARLIE_OOD1,
  'charlie.ood1': CHARLIE_OOD1,
}

export function getDevTestKeyPairById(id: string): DevTestKeyPair {
  const keyPair = DEV_TEST_KEYS[id]
  if (!keyPair) {
    throw new Error(`unknown dev test key pair id: ${id}`)
  }
  return keyPair
}
