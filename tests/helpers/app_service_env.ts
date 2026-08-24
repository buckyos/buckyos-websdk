export const TEST_APP_DID = 'did:web:test-app'
export const TEST_APP_ID = 'test-app'
export const TEST_APP_OWNER_USER_ID = 'alice'
export const TEST_APP_INSTANCE_ID = `${TEST_APP_ID}@${TEST_APP_OWNER_USER_ID}`
export const TEST_APP_DATA_DIR = '/tmp/buckyos-websdk-test-app-data'

function makeJwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) => Buffer.from(JSON.stringify(value))
    .toString('base64url')
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.signature`
}

export const TEST_APP_SERVICE_TOKEN = makeJwt({
  appid: TEST_APP_ID,
  sub: TEST_APP_OWNER_USER_ID,
  app_instance_id: TEST_APP_INSTANCE_ID,
  app_owner_user_id: TEST_APP_OWNER_USER_ID,
})

export function installTestAppServiceEnv(): void {
  Object.assign(process.env, {
    BUCKYOS_APP_DID: TEST_APP_DID,
    BUCKYOS_APP_ID: TEST_APP_ID,
    BUCKYOS_APP_INSTANCE_ID: TEST_APP_INSTANCE_ID,
    BUCKYOS_OWNER_USER_ID: TEST_APP_OWNER_USER_ID,
    BUCKYOS_DATA_DIR: TEST_APP_DATA_DIR,
    BUCKYOS_APP_TOKEN: TEST_APP_SERVICE_TOKEN,
  })
}
