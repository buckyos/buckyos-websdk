import { createSDKModule, RuntimeType } from '../src/sdk_core'

describe('browser runtime behavior', () => {
  const originalBuckyApi = (window as unknown as { BuckyApi?: unknown }).BuckyApi

  beforeEach(() => {
    window.localStorage.clear()
    ;(window as unknown as { BuckyApi?: unknown }).BuckyApi = undefined
  })

  afterAll(() => {
    ;(window as unknown as { BuckyApi?: unknown }).BuckyApi = originalBuckyApi
  })

  it('infers Browser runtime when BuckyApi is absent', () => {
    const sdkModule = createSDKModule('browser')

    expect(sdkModule.getRuntimeType()).toBe(RuntimeType.Browser)
  })

  it('infers AppRuntime when BuckyApi is present', () => {
    ;(window as unknown as { BuckyApi?: unknown }).BuckyApi = {}
    const sdkModule = createSDKModule('browser')

    expect(sdkModule.getRuntimeType()).toBe(RuntimeType.AppRuntime)
  })

  it('uses cached zone host from localStorage during init', async () => {
    window.localStorage.setItem('zone_host_name', 'test.buckyos.io')

    const sdkModule = createSDKModule('browser')
    await sdkModule.initBuckyOS('web-demo')

    expect(sdkModule.getZoneHostName()).toBe('test.buckyos.io')
    expect(sdkModule.getZoneServiceURL('verify-hub')).toBe('/kapi/verify-hub/')
  })

  it('delegates openExternalUrl to BuckyApi when available', async () => {
    const openExternalUrl = jest.fn().mockResolvedValue(undefined)
    ;(window as unknown as { BuckyApi?: unknown }).BuckyApi = { openExternalUrl }

    const sdkModule = createSDKModule('browser')
    await sdkModule.openExternalUrl('https://example.com')

    expect(openExternalUrl).toHaveBeenCalledWith('https://example.com')
  })

  it('falls back to window.open when BuckyApi is unavailable', async () => {
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null)

    try {
      const sdkModule = createSDKModule('browser')
      await sdkModule.openExternalUrl('https://example.com')

      expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer')
    } finally {
      openSpy.mockRestore()
    }
  })
})
