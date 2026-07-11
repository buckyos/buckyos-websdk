import { createSDKModule } from '../src/sdk_core'

describe('BuckyApi resolve_did bridge', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
    jest.restoreAllMocks()
  })

  it('returns the WebSDK EncodedDocument shape from the host', async () => {
    const resolveDid = jest.fn().mockResolvedValue({
      code: 0,
      data: { type: 'jwt', jwt: 'header.payload.signature' },
    })
    ;(globalThis as { window?: unknown }).window = {
      BuckyApi: { resolve_did: resolveDid },
    }
    const sdk = createSDKModule('browser')

    await expect(sdk.resolve_did('did:bns:alice', 'owner')).resolves.toEqual({
      type: 'jwt',
      jwt: 'header.payload.signature',
    })
    expect(resolveDid).toHaveBeenCalledWith('did:bns:alice', 'owner')
  })

  it('rejects a successful host response with an invalid document shape', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    ;(globalThis as { window?: unknown }).window = {
      BuckyApi: {
        resolve_did: jest.fn().mockResolvedValue({ code: 0, data: { Jwt: 'legacy-shape' } }),
      },
    }
    const sdk = createSDKModule('browser')

    await expect(sdk.resolve_did('did:bns:alice')).resolves.toBeNull()
  })
})
