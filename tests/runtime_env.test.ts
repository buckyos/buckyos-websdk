import { createSDKModule, RuntimeType } from '../src/sdk_core'
import { getBuckyApi, getRuntimeEnvironment } from '../src/runtime_env'

const globals = globalThis as { window?: unknown; navigator?: unknown; MediaRecorder?: unknown }
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
const setNavigator = (value: unknown) => Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true })
const env = { container: 'mobile-app', formFactor: 'mobile', platform: 'android', clientVersion: '1.0.0', capabilities: ['window.native', 7, 'audio.record'] }
const bridge = { env, call: async () => null, on: () => () => {} }
const page = (extra: Record<string, unknown> = {}) => {
  const win: Record<string, unknown> = { matchMedia: () => ({ matches: false }), ...extra }
  win.parent = win.parent ?? win
  return win
}

describe('runtime environment', () => {
  afterEach(() => {
    delete globals.window
    delete globals.MediaRecorder
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator)
    else delete globals.navigator
  })

  it('is what the client says, in the client', () => {
    globals.window = page({ BuckyApi: bridge })
    expect(getRuntimeEnvironment()).toEqual({ container: 'mobile-app', formFactor: 'mobile', platform: 'android', capabilities: ['window.native', 'audio.record'] })
    expect(createSDKModule('browser').buckyos.getRuntimeEnvironment().container).toBe('mobile-app')
    expect(createSDKModule('browser').getRuntimeType()).toBe(RuntimeType.AppRuntime)
  })

  it('needs env, call and on: an older bridge is a browser with a wallet', () => {
    setNavigator({})
    for (const BuckyApi of [{ getPublicKey: () => null }, { ...bridge, env: undefined }, { ...bridge, call: undefined }, { ...bridge, env: { ...env, container: 'browser' } }]) {
      globals.window = page({ BuckyApi })
      expect(getBuckyApi()).toBeUndefined()
      expect(getRuntimeEnvironment()).toEqual({ container: 'browser', formFactor: 'desktop', capabilities: [] })
    }
  })

  it('lists what a browser page can do by itself', () => {
    globals.MediaRecorder = class {}
    setNavigator({ mediaDevices: { getUserMedia: () => null }, mediaSession: {} })
    globals.window = page({ matchMedia: () => ({ matches: true }) })
    expect(getRuntimeEnvironment()).toEqual({ container: 'browser', formFactor: 'mobile', capabilities: ['audio.record', 'media.session'] })
  })

  it('takes the form factor of the device, not of the frame', () => {
    setNavigator({})
    globals.window = page({ parent: {}, screen: { width: 1920, height: 1080 }, matchMedia: () => ({ matches: true }) })
    expect(getRuntimeEnvironment().formFactor).toBe('desktop')
    globals.window = page({ parent: {}, screen: { width: 390, height: 844 } })
    expect(getRuntimeEnvironment().formFactor).toBe('mobile')
  })

  it('is not available outside a page', () => {
    expect(() => getRuntimeEnvironment()).toThrow('browser runtime')
  })
})
