import { getBuckyApi, getRuntimeEnvironment, type BuckyApi } from './runtime_env'

/**
 * Audio an App plays in the background or records. In the BuckyOS client the client does it; in a browser the page's
 * own means stand in. `audioCapabilities` says which one applies.
 */
export interface AudioCapabilities {
  /**
   * `native`: the client keeps the page playing when it is in the background. `media-session`: the system's media
   * controls work, and whether the page goes on playing is up to the browser. `none`: neither.
   */
  background: 'native' | 'media-session' | 'none'
  /** `native`: recorded by the client into a local file. `browser`: recorded by the page and kept in its memory. */
  record: 'native' | 'browser' | 'none'
}

export function audioCapabilities(): AudioCapabilities {
  const { container, capabilities } = getRuntimeEnvironment()
  return {
    background: container !== 'browser' && capabilities.includes('audio.background') ? 'native' : capabilities.includes('media.session') ? 'media-session' : 'none',
    record: !capabilities.includes('audio.record') ? 'none' : container === 'browser' ? 'browser' : 'native',
  }
}

export type AudioErrorCode = 'unsupported' | 'denied' | 'busy' | 'not_found' | 'invalid_state' | 'failed'
const ERROR_CODES: readonly string[] = ['unsupported', 'denied', 'busy', 'not_found', 'invalid_state', 'failed']
export class AudioError extends Error {
  constructor(readonly code: AudioErrorCode, message?: string) {
    super(message ?? `Audio: ${code}`)
    this.name = 'AudioError'
  }
}
async function callNative(api: BuckyApi, name: string, payload: unknown): Promise<unknown> {
  try { return await api.call(name, payload) }
  catch (error) {
    const code = (error as { code?: unknown } | null)?.code
    throw new AudioError(typeof code === 'string' && ERROR_CODES.includes(code) ? code as AudioErrorCode : 'failed', error instanceof Error ? error.message : undefined)
  }
}

export interface BackgroundAudioInfo {
  title: string
  artist?: string
  /** Address of an image; a relative one is resolved against the page. */
  artwork?: string
}
export type BackgroundAudioCommand = 'play' | 'pause' | 'stop' | 'next' | 'previous'
export interface BackgroundAudioHandle {
  /** Changes what the system shows; `playing` decides between its play and pause button. */
  update(patch: Partial<BackgroundAudioInfo> & { playing?: boolean }): Promise<void>
  /** Call it when playback is over: until then the client keeps the page alive. */
  release(): Promise<void>
  /** The user pressed a button of the system's media controls. Returns the function that stops listening. */
  onCommand(handler: (command: BackgroundAudioCommand) => void): () => void
}

const COMMANDS: Record<BackgroundAudioCommand, MediaSessionAction> = { play: 'play', pause: 'pause', stop: 'stop', next: 'nexttrack', previous: 'previoustrack' }
type BackgroundAudioState = BackgroundAudioInfo & { playing: boolean }
/** Where a handle takes effect. */
interface BackgroundAudioTarget {
  acquire(state: BackgroundAudioState): Promise<void>
  update(state: BackgroundAudioState): Promise<void>
  release(): Promise<void>
  listen(emit: (command: BackgroundAudioCommand) => void): () => void
}

const nativeTarget = (api: BuckyApi): BackgroundAudioTarget => ({
  acquire: async state => { await callNative(api, 'audio.background.acquire', state) },
  update: async state => { await callNative(api, 'audio.background.update', state) },
  release: async () => { await callNative(api, 'audio.background.release', {}) },
  listen: emit => api.on('audio.background.command', payload => {
    const command = (payload as { command?: unknown } | null)?.command
    if (typeof command === 'string' && command in COMMANDS) emit(command as BackgroundAudioCommand)
  }),
})
function mediaSessionTarget(session: MediaSession): BackgroundAudioTarget {
  const show = async (state: BackgroundAudioState) => {
    if (typeof MediaMetadata !== 'undefined') {
      session.metadata = new MediaMetadata({ title: state.title, artist: state.artist ?? '', artwork: state.artwork ? [{ src: state.artwork }] : [] })
    }
    session.playbackState = state.playing ? 'playing' : 'paused'
  }
  const handle = (action: MediaSessionAction, handler: (() => void) | null) => { try { session.setActionHandler(action, handler) } catch {} }
  const commands = Object.entries(COMMANDS) as Array<[BackgroundAudioCommand, MediaSessionAction]>
  return {
    acquire: show, update: show,
    release: async () => { session.metadata = null; session.playbackState = 'none' },
    listen: emit => {
      commands.forEach(([command, action]) => handle(action, () => emit(command)))
      return () => commands.forEach(([, action]) => handle(action, null))
    },
  }
}
const noTarget: BackgroundAudioTarget = { acquire: async () => {}, update: async () => {}, release: async () => {}, listen: () => () => {} }

let holder: BackgroundAudio | undefined
let queue: Promise<unknown> = Promise.resolve()
const inOrder = <T>(run: () => Promise<T>): Promise<T> => {
  const next = queue.then(run)
  queue = next.catch(() => {})
  return next
}
class BackgroundAudio implements BackgroundAudioHandle {
  private handlers = new Set<(command: BackgroundAudioCommand) => void>()
  private unlisten?: () => void
  constructor(private target: BackgroundAudioTarget, private state: BackgroundAudioState) {}
  /** Another handle took over: this one no longer has any effect. */
  detach(): void {
    this.unlisten?.()
    this.unlisten = undefined
    this.handlers.clear()
  }
  update(patch: Partial<BackgroundAudioInfo> & { playing?: boolean }): Promise<void> {
    this.state = readState({ ...this.state, ...patch })
    return inOrder(async () => { if (holder === this) await this.target.update(this.state) })
  }
  release(): Promise<void> {
    return inOrder(async () => {
      if (holder !== this) return
      holder = undefined
      this.detach()
      await this.target.release()
    })
  }
  onCommand(handler: (command: BackgroundAudioCommand) => void): () => void {
    if (holder !== this) return () => {}
    this.handlers.add(handler)
    this.unlisten ??= this.target.listen(command => this.handlers.forEach(h => h(command)))
    return () => {
      this.handlers.delete(handler)
      if (!this.handlers.size) { this.unlisten?.(); this.unlisten = undefined }
    }
  }
}
function readState(info: BackgroundAudioInfo & { playing?: boolean }): BackgroundAudioState {
  const state: BackgroundAudioState = { title: info.title, playing: info.playing !== false }
  if (info.artist) state.artist = info.artist
  if (info.artwork) { try { state.artwork = new URL(info.artwork, window.location.href).href } catch {} }
  return state
}

/**
 * Asks to keep this page's sound playing while the page is in the background. The sound still comes from the page (an
 * `<audio>` element). A page holds one handle: acquiring again replaces it, and the earlier one stops having effect.
 */
export function acquireBackgroundAudio(info: BackgroundAudioInfo): Promise<BackgroundAudioHandle> {
  const { background } = audioCapabilities()
  const target = background === 'native' ? nativeTarget(getBuckyApi()!) : background === 'media-session' ? mediaSessionTarget(navigator.mediaSession) : noTarget
  const state = readState(info)
  return inOrder(async () => {
    await target.acquire(state)
    holder?.detach()
    holder = new BackgroundAudio(target, state)
    return holder
  })
}

export interface StartRecordingOptions {
  title?: string
  sampleRate?: number
  channels?: 1 | 2
  bitRate?: number
}
/** A finished recording. The client keeps it as a local file; in a browser it lasts as long as the page. */
export interface AudioRecording {
  id: string
  title?: string
  mime: string
  size: number
  durationMs?: number
  /** Milliseconds since the epoch. */
  createdAt: number
}
/** `interrupted`: the system took the microphone; the recording can be resumed or stopped. */
export type AudioRecordingState = 'idle' | 'recording' | 'paused' | 'interrupted'
export interface AudioRecordingStatus {
  state: AudioRecordingState
  /** The recording in progress or, when it just ended by itself, the one that ended. */
  id?: string
  startedAt?: number
  /** Recorded time, without pauses. */
  elapsedMs: number
  /** Why it was interrupted or ended. */
  error?: AudioErrorCode
}

/** One recording at a time. */
interface Recorder {
  start(options: StartRecordingOptions): Promise<AudioRecordingStatus>
  pause(): Promise<AudioRecordingStatus>
  resume(): Promise<AudioRecordingStatus>
  stop(): Promise<AudioRecording>
  status(): Promise<AudioRecordingStatus>
  list(): Promise<AudioRecording[]>
  get(id: string): Promise<AudioRecording & { blob: Blob }>
  delete(id: string): Promise<void>
  listen(handler: (status: AudioRecordingStatus) => void): () => void
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {}
function readRecording(value: unknown): AudioRecording {
  const v = record(value)
  if (typeof v.id !== 'string' || !v.id || typeof v.mime !== 'string' || !isCount(v.size) || !isCount(v.createdAt)) throw new AudioError('failed', 'Invalid recording')
  return { id: v.id, mime: v.mime, size: v.size, createdAt: v.createdAt, ...(typeof v.title === 'string' ? { title: v.title } : {}), ...(isCount(v.durationMs) ? { durationMs: v.durationMs } : {}) }
}
function readStatus(value: unknown): AudioRecordingStatus {
  const v = record(value)
  if (v.state !== 'idle' && v.state !== 'recording' && v.state !== 'paused' && v.state !== 'interrupted') throw new AudioError('failed', 'Invalid recording status')
  return {
    state: v.state, elapsedMs: isCount(v.elapsedMs) ? v.elapsedMs : 0,
    ...(typeof v.id === 'string' ? { id: v.id } : {}), ...(isCount(v.startedAt) ? { startedAt: v.startedAt } : {}),
    ...(typeof v.error === 'string' ? { error: ERROR_CODES.includes(v.error) ? v.error as AudioErrorCode : 'failed' } : {}),
  }
}
/** Bytes of a recording in one call of the bridge, where they travel as base64. */
const READ_CHUNK = 512 * 1024
const nativeRecorder = (api: BuckyApi): Recorder => {
  const call = (name: string, payload: unknown = {}) => callNative(api, `audio.record.${name}`, payload)
  return {
    start: async options => readStatus(await call('start', options)),
    pause: async () => readStatus(await call('pause')),
    resume: async () => readStatus(await call('resume')),
    stop: async () => readRecording(await call('stop')),
    status: async () => readStatus(await call('status')),
    list: async () => {
      const { recordings } = record(await call('list'))
      return Array.isArray(recordings) ? recordings.map(readRecording) : []
    },
    get: async id => {
      const parts: Uint8Array[] = []
      for (let offset = 0; ;) {
        const chunk = record(await call('get', { id, offset, length: READ_CHUNK }))
        if (typeof chunk.data !== 'string') throw new AudioError('failed', 'Invalid recording data')
        const bytes = Uint8Array.from(atob(chunk.data), c => c.charCodeAt(0))
        parts.push(bytes)
        offset += bytes.length
        if (chunk.eof === true || !bytes.length) {
          const recording = readRecording(chunk.recording)
          return { ...recording, blob: new Blob(parts, { type: recording.mime }) }
        }
      }
    },
    delete: async id => { await call('delete', { id }) },
    listen: handler => api.on('audio.record.state', payload => {
      let status: AudioRecordingStatus
      try { status = readStatus(payload) } catch { return }
      handler(status)
    }),
  }
}

const RECORDER_TYPES = ['audio/mp4;codecs=mp4a.40.2', 'audio/webm;codecs=opus', 'audio/mp4']
interface PageRecording {
  id: string
  startedAt: number
  recorded: number
  /** When the current stretch of recording began. */
  since?: number
  recorder: MediaRecorder
  finished: Promise<AudioRecording>
}
function pageRecorder(): Recorder {
  const recordings = new Map<string, AudioRecording & { blob: Blob }>()
  const listeners = new Set<(status: AudioRecordingStatus) => void>()
  let active: PageRecording | undefined
  let starting = false
  const elapsed = (r: PageRecording) => r.recorded + (r.since === undefined ? 0 : Date.now() - r.since)
  const status = (): AudioRecordingStatus => active
    ? { state: active.recorder.state === 'paused' ? 'paused' : 'recording', id: active.id, startedAt: active.startedAt, elapsedMs: elapsed(active) }
    : { state: 'idle', elapsedMs: 0 }
  const emit = (value: AudioRecordingStatus): AudioRecordingStatus => { listeners.forEach(l => l(value)); return value }
  const current = (...states: RecordingState[]): PageRecording => {
    if (!active || !states.includes(active.recorder.state)) throw new AudioError('invalid_state')
    return active
  }
  return {
    start: async options => {
      if (active || starting) throw new AudioError('busy')
      starting = true
      let stream: MediaStream | undefined
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: {
          ...(options.sampleRate ? { sampleRate: options.sampleRate } : {}), ...(options.channels ? { channelCount: options.channels } : {}),
        } })
        const mimeType = RECORDER_TYPES.find(type => MediaRecorder.isTypeSupported(type))
        const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), ...(options.bitRate ? { audioBitsPerSecond: options.bitRate } : {}) })
        const tracks = stream.getTracks()
        const chunks: Blob[] = []
        const finished = new Promise<AudioRecording>(resolve => {
          recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
          recorder.onstop = () => {
            tracks.forEach(track => track.stop())
            const mime = (recorder.mimeType || mimeType || 'audio/webm').split(';')[0]
            const blob = new Blob(chunks, { type: mime })
            const recording: AudioRecording = { id, mime, size: blob.size, durationMs: elapsed(own), createdAt: own.startedAt, ...(options.title ? { title: options.title } : {}) }
            recordings.set(id, { ...recording, blob })
            const byItself = active === own
            active = undefined
            emit(byItself ? { state: 'idle', id, elapsedMs: elapsed(own), error: 'failed' } : { state: 'idle', elapsedMs: 0 })
            resolve(recording)
          }
        })
        const id = crypto.randomUUID()
        const own: PageRecording = { id, startedAt: Date.now(), recorded: 0, since: Date.now(), recorder, finished }
        recorder.start(1000)
        active = own
        return emit(status())
      } catch (error) {
        stream?.getTracks().forEach(track => track.stop())
        if (error instanceof AudioError) throw error
        const name = (error as { name?: unknown } | null)?.name
        throw new AudioError(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' ? 'not_found' : 'failed', error instanceof Error ? error.message : undefined)
      } finally { starting = false }
    },
    pause: async () => {
      const own = current('recording')
      own.recorder.pause()
      own.recorded = elapsed(own); own.since = undefined
      return emit(status())
    },
    resume: async () => {
      const own = current('paused')
      own.recorder.resume()
      own.since = Date.now()
      return emit(status())
    },
    stop: async () => {
      const own = current('recording', 'paused')
      own.recorded = elapsed(own); own.since = undefined
      active = undefined
      own.recorder.stop()
      return own.finished
    },
    status: async () => status(),
    list: async () => [...recordings.values()].map(({ blob: _blob, ...recording }) => recording).sort((a, b) => b.createdAt - a.createdAt),
    get: async id => {
      const found = recordings.get(id)
      if (!found) throw new AudioError('not_found')
      return { ...found }
    },
    delete: async id => { if (!recordings.delete(id)) throw new AudioError('not_found') },
    listen: handler => { listeners.add(handler); return () => { listeners.delete(handler) } },
  }
}

let page: Recorder | undefined
function recorder(): Recorder {
  const { record: kind } = audioCapabilities()
  if (kind === 'none') throw new AudioError('unsupported')
  return kind === 'native' ? nativeRecorder(getBuckyApi()!) : page ??= pageRecorder()
}

/** Starts recording the microphone. Rejects with an `AudioError`: `unsupported`, `denied`, `busy`, … */
export async function startRecording(options: StartRecordingOptions = {}): Promise<AudioRecordingStatus> { return recorder().start(options) }
export async function pauseRecording(): Promise<AudioRecordingStatus> { return recorder().pause() }
export async function resumeRecording(): Promise<AudioRecordingStatus> { return recorder().resume() }
export async function stopRecording(): Promise<AudioRecording> { return recorder().stop() }
export async function getRecordingStatus(): Promise<AudioRecordingStatus> { return recorder().status() }
/** This App's finished recordings, newest first. */
export async function listRecordings(): Promise<AudioRecording[]> { return recorder().list() }
export async function getRecording(id: string): Promise<AudioRecording & { blob: Blob }> { return recorder().get(id) }
export async function deleteRecording(id: string): Promise<void> { return recorder().delete(id) }
/** Called when the recording starts, pauses, resumes or ends. Returns the function that stops listening. */
export function onRecordingState(handler: (status: AudioRecordingStatus) => void): () => void {
  return audioCapabilities().record === 'none' ? () => {} : recorder().listen(handler)
}
