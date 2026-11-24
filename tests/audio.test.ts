import { acquireBackgroundAudio, audioCapabilities, deleteRecording, getRecording, getRecordingStatus, listRecordings, onRecordingState, pauseRecording, resumeRecording, startRecording, stopRecording, type AudioRecordingStatus } from '../src/audio'

const globals = globalThis as Record<string, unknown>
const saved = Object.fromEntries(['window', 'navigator', 'MediaRecorder', 'MediaMetadata'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
const setGlobal = (key: string, value: unknown) => Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
afterEach(() => {
  for (const [key, descriptor] of Object.entries(saved)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else delete globals[key]
  }
})

function inClient(capabilities: string[], answer: (name: string, payload: any) => unknown = () => null) {
  const calls: Array<[string, unknown]> = []
  const handlers = new Map<string, Set<(payload: unknown) => void>>()
  const win: Record<string, unknown> = {
    location: { href: 'https://music.zone.example/player/' },
    BuckyApi: {
      env: { container: 'mobile-app', formFactor: 'mobile', platform: 'android', clientVersion: '1', capabilities },
      call: async (name: string, payload: unknown) => { calls.push([name, payload]); return answer(name, payload) },
      on: (event: string, handler: (payload: unknown) => void) => {
        if (!handlers.has(event)) handlers.set(event, new Set())
        handlers.get(event)!.add(handler)
        return () => { handlers.get(event)!.delete(handler) }
      },
    },
  }
  win.parent = win
  setGlobal('window', win)
  setGlobal('navigator', {})
  return { calls, emit: (event: string, payload: unknown) => handlers.get(event)?.forEach(h => h(payload)), listening: (event: string) => handlers.get(event)?.size ?? 0 }
}
function inBrowser(navigator: Record<string, unknown> = {}) {
  const win: Record<string, unknown> = { location: { href: 'https://music.zone.example/player/' } }
  win.parent = win
  setGlobal('window', win)
  setGlobal('navigator', navigator)
}

describe('background audio', () => {
  const info = { title: 'Song', artist: 'Band', artwork: 'cover.png' }
  const shown = { title: 'Song', artist: 'Band', artwork: 'https://music.zone.example/player/cover.png', playing: true }

  it('goes to the client when it offers it', async () => {
    const client = inClient(['audio.background'])
    expect(audioCapabilities()).toEqual({ background: 'native', record: 'none' })
    const handle = await acquireBackgroundAudio(info)
    const commands: string[] = []
    const off = handle.onCommand(command => commands.push(command))
    client.emit('audio.background.command', { command: 'pause' })
    client.emit('audio.background.command', { command: 'explode' })
    client.emit('audio.background.command', null)
    await handle.update({ title: 'Next', playing: false })
    off()
    expect(client.listening('audio.background.command')).toBe(0)
    await handle.release()
    await handle.release()
    expect(commands).toEqual(['pause'])
    expect(client.calls).toEqual([
      ['audio.background.acquire', shown],
      ['audio.background.update', { ...shown, title: 'Next', playing: false }],
      ['audio.background.release', {}],
    ])
  })

  it('is held once: the handle acquired last has effect', async () => {
    const client = inClient(['audio.background'])
    const first = await acquireBackgroundAudio({ title: 'One' })
    const commands: string[] = []
    first.onCommand(command => commands.push(command))
    const second = await acquireBackgroundAudio({ title: 'Two' })
    client.emit('audio.background.command', { command: 'play' })
    await first.update({ title: 'Late' })
    await first.release()
    expect(commands).toEqual([])
    expect(client.calls.map(([name]) => name)).toEqual(['audio.background.acquire', 'audio.background.acquire'])
    await second.release()
    expect(client.calls[2][0]).toBe('audio.background.release')
  })

  it('reports a failure of the client with its code', async () => {
    inClient(['audio.background'], () => { throw Object.assign(new Error('no permission'), { code: 'denied' }) })
    await expect(acquireBackgroundAudio({ title: 'x' })).rejects.toMatchObject({ code: 'denied', message: 'no permission' })
    inClient(['audio.background'], () => { throw Object.assign(new Error('odd'), { code: 'E_ODD' }) })
    await expect(acquireBackgroundAudio({ title: 'x' })).rejects.toMatchObject({ code: 'failed' })
    const ok = inClient(['audio.background'])
    await (await acquireBackgroundAudio({ title: 'x' })).release()
    expect(ok.calls).toHaveLength(2)
  })

  it('uses the media session of a browser', async () => {
    const actions = new Map<string, unknown>()
    const session: Record<string, unknown> = {
      metadata: null, playbackState: 'none',
      setActionHandler: (action: string, handler: unknown) => { if (action === 'stop') throw new TypeError('unsupported'); actions.set(action, handler) },
    }
    inBrowser({ mediaSession: session })
    setGlobal('MediaMetadata', class { constructor(readonly init: unknown) {} })
    expect(audioCapabilities().background).toBe('media-session')
    const handle = await acquireBackgroundAudio(info)
    expect(session.metadata).toMatchObject({ init: { title: 'Song', artist: 'Band', artwork: [{ src: shown.artwork }] } })
    expect(session.playbackState).toBe('playing')
    expect(actions.size).toBe(0)
    const commands: string[] = []
    handle.onCommand(command => commands.push(command))
    ;(actions.get('nexttrack') as () => void)()
    expect(commands).toEqual(['next'])
    await handle.update({ playing: false })
    expect(session.playbackState).toBe('paused')
    await handle.release()
    expect(session).toMatchObject({ metadata: null, playbackState: 'none' })
    expect([...actions.values()]).toEqual([null, null, null, null])
  })

  it('does nothing where there is nothing to use', async () => {
    inClient([])
    expect(audioCapabilities()).toEqual({ background: 'none', record: 'none' })
    const handle = await acquireBackgroundAudio(info)
    handle.onCommand(() => {})()
    await handle.update({ playing: false })
    await handle.release()
  })
})

describe('recording in the client', () => {
  const recording = { id: 'r1', title: 'Memo', mime: 'audio/mp4', size: 5, durationMs: 1200, createdAt: 10 }

  it('passes the calls on and reads the file in chunks', async () => {
    const data = Buffer.from('abcde')
    const client = inClient(['audio.record'], (name, payload) => {
      if (name === 'audio.record.list') return { recordings: [recording] }
      if (name === 'audio.record.stop') return { ...recording, path: '/secret' }
      if (name === 'audio.record.get') {
        const part = data.subarray(payload.offset, payload.offset + 2)
        return { recording, data: part.toString('base64'), eof: payload.offset + part.length >= data.length }
      }
      if (name === 'audio.record.delete') return null
      return { state: name === 'audio.record.pause' ? 'paused' : 'recording', id: 'r1', startedAt: 10, elapsedMs: 3 }
    })
    expect(audioCapabilities().record).toBe('native')
    const states: AudioRecordingStatus[] = []
    const off = onRecordingState(status => states.push(status))
    client.emit('audio.record.state', { state: 'interrupted', id: 'r1', elapsedMs: 9, error: 'MIC_LOST' })
    client.emit('audio.record.state', { state: 'exploded' })
    off()
    expect(states).toEqual([{ state: 'interrupted', id: 'r1', elapsedMs: 9, error: 'failed' }])
    expect(await startRecording({ title: 'Memo', channels: 1 })).toEqual({ state: 'recording', id: 'r1', startedAt: 10, elapsedMs: 3 })
    expect((await pauseRecording()).state).toBe('paused')
    expect((await resumeRecording()).state).toBe('recording')
    expect((await getRecordingStatus()).state).toBe('recording')
    expect(await stopRecording()).toEqual(recording)
    expect(await listRecordings()).toEqual([recording])
    const { blob, ...found } = await getRecording('r1')
    expect(found).toEqual(recording)
    expect(await blob.text()).toBe('abcde')
    expect(blob.type).toBe('audio/mp4')
    await deleteRecording('r1')
    expect(client.calls.map(([name]) => name.replace('audio.record.', ''))).toEqual(['start', 'pause', 'resume', 'status', 'stop', 'list', 'get', 'get', 'get', 'delete'])
    expect(client.calls[0][1]).toEqual({ title: 'Memo', channels: 1 })
  })

  it('keeps the code of a refusal and is unsupported where the client does not record', async () => {
    inClient(['audio.record'], () => { throw Object.assign(new Error('taken'), { code: 'busy' }) })
    await expect(startRecording()).rejects.toMatchObject({ code: 'busy' })
    inClient(['audio.background'])
    await expect(startRecording()).rejects.toMatchObject({ code: 'unsupported' })
    expect(() => onRecordingState(() => {})()).not.toThrow()
  })
})

describe('recording in a browser', () => {
  class Recorder {
    static isTypeSupported = (type: string) => type === 'audio/webm;codecs=opus'
    static last: Recorder
    state = 'inactive'
    mimeType: string
    ondataavailable?: (event: { data: Blob }) => void
    onstop?: () => void
    constructor(readonly stream: unknown, readonly options: { mimeType: string; audioBitsPerSecond?: number }) { this.mimeType = options.mimeType; Recorder.last = this }
    start() { this.state = 'recording' }
    pause() { this.state = 'paused' }
    resume() { this.state = 'recording' }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['sound']) }); queueMicrotask(() => this.onstop?.()) }
  }
  const stopped = jest.fn()
  const browser = (getUserMedia: () => Promise<unknown> = async () => ({ getTracks: () => [{ stop: stopped }] })) => {
    inBrowser({ mediaDevices: { getUserMedia } })
    setGlobal('MediaRecorder', Recorder)
  }

  it('records, pauses, and keeps the result for the page', async () => {
    browser()
    expect(audioCapabilities().record).toBe('browser')
    const states: string[] = []
    const off = onRecordingState(status => states.push(status.state))
    const started = await startRecording({ title: 'Memo', bitRate: 64000 })
    expect(started).toMatchObject({ state: 'recording', elapsedMs: expect.any(Number) })
    expect(Recorder.last.options).toEqual({ mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 64000 })
    await expect(startRecording()).rejects.toMatchObject({ code: 'busy' })
    await expect(resumeRecording()).rejects.toMatchObject({ code: 'invalid_state' })
    expect((await pauseRecording()).state).toBe('paused')
    expect((await resumeRecording()).state).toBe('recording')
    const result = await stopRecording()
    expect(result).toMatchObject({ id: started.id, title: 'Memo', mime: 'audio/webm', size: 5 })
    expect(stopped).toHaveBeenCalled()
    expect(states).toEqual(['recording', 'paused', 'recording', 'idle'])
    await expect(stopRecording()).rejects.toMatchObject({ code: 'invalid_state' })
    expect((await listRecordings()).map(r => r.id)).toEqual([result.id])
    expect(await (await getRecording(result.id)).blob.text()).toBe('sound')
    await deleteRecording(result.id)
    await expect(getRecording(result.id)).rejects.toMatchObject({ code: 'not_found' })
    expect(await listRecordings()).toEqual([])
    off()
  })

  it('keeps what was recorded when the microphone goes away', async () => {
    browser()
    const states: AudioRecordingStatus[] = []
    const off = onRecordingState(status => states.push(status))
    const { id } = await startRecording()
    Recorder.last.stop()
    await Promise.resolve()
    expect(states[1]).toMatchObject({ state: 'idle', id, error: 'failed' })
    expect((await getRecordingStatus()).state).toBe('idle')
    expect((await listRecordings()).map(r => r.id)).toContain(id)
    off()
  })

  it('says why it could not start, and can start again', async () => {
    browser(async () => { throw Object.assign(new Error('no'), { name: 'NotAllowedError' }) })
    await expect(startRecording()).rejects.toMatchObject({ code: 'denied' })
    browser()
    await startRecording()
    await stopRecording()
  })
})
