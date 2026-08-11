declare const require: undefined | ((name: string) => any)

const DEFAULT_HTTP_KEEPALIVE_MS = 15_000
const DEFAULT_NATIVE_HOST = '127.0.0.1'
const DEFAULT_NATIVE_PORT = 3183
const DEFAULT_NATIVE_CONNECT_TIMEOUT_MS = 5_000
const DEFAULT_SUBSCRIBE_RECONNECT_DELAY_MS = 1_000
const MAX_NATIVE_FRAME_SIZE = 1024 * 1024

export interface KEvent {
  eventid: string
  source_node: string
  source_pid: number
  ingress_node?: string | null
  timestamp: number
  data: unknown
}

type KEventDaemonRequest =
  | {
    op: 'register_reader'
    reader_id: string
    patterns: string[]
  }
  | {
    op: 'unregister_reader'
    reader_id: string
  }
  | {
    op: 'pull_event'
    reader_id: string
    timeout_ms?: number
  }

type KEventDaemonResponse =
  | {
    status: 'ok'
    event?: KEvent
  }
  | {
    status: 'err'
    code: string
    message: string
  }

type KEventStreamFrame =
  | {
    type: 'ack'
    connection_id: string
    keepalive_ms?: number
  }
  | {
    type: 'event'
    event: KEvent
  }
  | {
    type: 'keepalive'
    at_ms?: number
  }
  | {
    type: 'error'
    error: string
  }

export type KEventFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
export type KEventSessionTokenProvider = () => Promise<string | null | undefined> | string | null | undefined

export type KEventTransportMode = 'browser' | 'native'
export type KEventPatternInput = string | string[]
export type KEventCallback = (event: KEvent) => void | Promise<void>

export interface KEventReaderOptions {
  keepaliveMs?: number
  signal?: AbortSignal
}

export interface KEventSubscribeOptions extends KEventReaderOptions {
  reconnectDelayMs?: number
}

export interface KEventSubscription {
  close(): Promise<void>
}

export interface KEventClientOptions {
  mode: KEventTransportMode
  streamUrl?: string
  nativeHost?: string
  nativePort?: number
  nativeConnectTimeoutMs?: number
  fetcher?: KEventFetcher
  sessionTokenProvider?: KEventSessionTokenProvider
  nativeConnector?: KEventNativeConnector
}

export interface KEventNativeSocket {
  write(
    data: Uint8Array,
    callback?: (error?: Error | null) => void,
  ): boolean
  end(callback?: () => void): void
  destroy(error?: Error): void
  setNoDelay?(noDelay?: boolean): void
  once(event: string, listener: (...args: any[]) => void): this
  on(event: string, listener: (...args: any[]) => void): this
  off?(event: string, listener: (...args: any[]) => void): this
  removeListener?(event: string, listener: (...args: any[]) => void): this
}

export type KEventNativeConnector = (
  host: string,
  port: number,
  connectTimeoutMs: number,
) => Promise<KEventNativeSocket>

class KEventProtocolError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'KEventProtocolError'
    this.code = code
  }
}

const defaultFetcher: KEventFetcher = async (input, init) => {
  if (typeof fetch !== 'function') {
    throw new Error('fetch is not available in this runtime')
  }
  return fetch(input, init)
}

function hasNodeRuntime(): boolean {
  const runtimeProcess = (globalThis as { process?: { versions?: { node?: string } } }).process
  return Boolean(runtimeProcess?.versions?.node)
}

async function importNodeModule(moduleName: string): Promise<any> {
  if (hasNodeRuntime() && typeof require === 'function') {
    return require(moduleName)
  }

  const dynamicImport = Function('name', 'return import(name)')
  return dynamicImport(moduleName) as Promise<any>
}

function normalizePatterns(patterns: KEventPatternInput): string[] {
  const normalized = (Array.isArray(patterns) ? patterns : [patterns])
    .map((pattern) => (typeof pattern === 'string' ? pattern.trim() : ''))
    .filter((pattern) => pattern.length > 0)

  if (normalized.length === 0) {
    throw new Error('kevent patterns must not be empty')
  }

  for (const pattern of normalized) {
    if (!pattern.startsWith('/')) {
      throw new Error(`kevent only supports global patterns: ${pattern}`)
    }
  }

  return normalized
}

function normalizeKeepaliveMs(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_HTTP_KEEPALIVE_MS
  }
  return Math.floor(value)
}

function buildStreamUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/stream`
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new Error('Operation aborted'))
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)

    const onAbort = () => {
      clearTimeout(timeout)
      cleanup()
      reject(new Error('Operation aborted'))
    }

    const cleanup = () => {
      if (signal) {
        signal.removeEventListener('abort', onAbort)
      }
    }

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

function generateReaderId(): string {
  return `ts_kevent_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function assertDaemonResponseOk(response: KEventDaemonResponse): { event?: KEvent } {
  if (response.status === 'ok') {
    return response
  }

  throw new KEventProtocolError(response.code || 'INTERNAL', response.message || 'Unknown kevent error')
}

function validateEvent(event: unknown): KEvent {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new Error('Invalid kevent event payload')
  }

  const candidate = event as Record<string, unknown>
  if (
    typeof candidate.eventid !== 'string'
    || typeof candidate.source_node !== 'string'
    || typeof candidate.source_pid !== 'number'
    || typeof candidate.timestamp !== 'number'
  ) {
    throw new Error('Invalid kevent event payload')
  }

  return {
    eventid: candidate.eventid,
    source_node: candidate.source_node,
    source_pid: candidate.source_pid,
    ingress_node: typeof candidate.ingress_node === 'string' ? candidate.ingress_node : null,
    timestamp: candidate.timestamp,
    data: 'data' in candidate ? candidate.data : null,
  }
}

class AsyncEventQueue<T> {
  private readonly items: T[] = []
  private readonly waiters: Array<{
    resolve: (value: T | null) => void
    timeout: ReturnType<typeof setTimeout> | null
  }> = []
  private closed = false

  push(item: T) {
    if (this.closed) {
      return
    }

    const waiter = this.waiters.shift()
    if (waiter) {
      if (waiter.timeout) {
        clearTimeout(waiter.timeout)
      }
      waiter.resolve(item)
      return
    }

    this.items.push(item)
  }

  async shift(timeoutMs?: number): Promise<T | null> {
    if (this.items.length > 0) {
      return this.items.shift() ?? null
    }

    if (this.closed) {
      return null
    }

    if (timeoutMs === 0) {
      return null
    }

    return new Promise((resolve) => {
      const waiter = {
        resolve: (value: T | null) => {
          cleanup()
          resolve(value)
        },
        timeout: null as ReturnType<typeof setTimeout> | null,
      }

      const cleanup = () => {
        if (waiter.timeout) {
          clearTimeout(waiter.timeout)
          waiter.timeout = null
        }
        const index = this.waiters.indexOf(waiter)
        if (index >= 0) {
          this.waiters.splice(index, 1)
        }
      }

      if (typeof timeoutMs === 'number' && timeoutMs > 0) {
        waiter.timeout = setTimeout(() => {
          cleanup()
          resolve(null)
        }, timeoutMs)
      }

      this.waiters.push(waiter)
    })
  }

  close() {
    if (this.closed) {
      return
    }

    this.closed = true
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()
      if (!waiter) {
        continue
      }
      if (waiter.timeout) {
        clearTimeout(waiter.timeout)
      }
      waiter.resolve(null)
    }
  }
}

export abstract class KEventReader {
  private readonly queue = new AsyncEventQueue<KEvent>()
  private closed = false
  private closePromise: Promise<void> | null = null

  async pullEvent(timeoutMs?: number): Promise<KEvent | null> {
    return this.queue.shift(timeoutMs)
  }

  async pull_event(timeoutMs?: number): Promise<KEvent | null> {
    return this.pullEvent(timeoutMs)
  }

  protected enqueue(event: KEvent) {
    this.queue.push(event)
  }

  protected isClosed(): boolean {
    return this.closed
  }

  protected markClosed() {
    this.closed = true
    this.queue.close()
  }

  async close(): Promise<void> {
    if (this.closePromise) {
      return this.closePromise
    }

    this.markClosed()
    this.closePromise = this.closeTransport()
      .catch((error) => {
        console.warn('kevent reader close failed:', error)
      })
      .then(() => undefined)

    return this.closePromise
  }

  protected abstract closeTransport(): Promise<void>
}

class BrowserKEventReader extends KEventReader {
  private readonly controller: AbortController
  private readonly readyPromise: Promise<void>
  private streamTask: Promise<void> | null = null

  constructor(
    private readonly streamUrl: string,
    private readonly patterns: string[],
    private readonly keepaliveMs: number,
    private readonly fetcher: KEventFetcher,
    private readonly sessionTokenProvider: KEventSessionTokenProvider | null,
    signal?: AbortSignal,
  ) {
    super()
    this.controller = new AbortController()
    this.readyPromise = this.start()

    if (signal) {
      if (signal.aborted) {
        this.controller.abort()
      } else {
        signal.addEventListener('abort', () => {
          this.controller.abort()
        }, { once: true })
      }
    }
  }

  async waitUntilReady(): Promise<void> {
    await this.readyPromise
  }

  private async start(): Promise<void> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (this.sessionTokenProvider) {
      const token = await this.sessionTokenProvider()
      if (typeof token === 'string' && token.trim().length > 0) {
        headers.Authorization = `Bearer ${token.trim()}`
      }
    }

    const response = await this.fetcher(this.streamUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        patterns: this.patterns,
        keepalive_ms: this.keepaliveMs,
      }),
      cache: 'no-store',
      credentials: 'include',
      signal: this.controller.signal,
    })

    if (!response.ok) {
      let detail = ''
      try {
        detail = await response.text()
      } catch {
        detail = ''
      }
      throw new Error(`kevent stream request failed: ${response.status}${detail ? ` ${detail}` : ''}`)
    }

    if (!response.body) {
      throw new Error('kevent stream response missing body')
    }

    let acked = false
    let resolveAck: (() => void) | null = null
    let rejectAck: ((error: Error) => void) | null = null
    const ackPromise = new Promise<void>((resolve, reject) => {
      resolveAck = resolve
      rejectAck = reject
    })

    this.streamTask = this.consumeStream(response.body, (frame) => {
      if (frame.type === 'ack') {
        acked = true
        resolveAck?.()
        return
      }

      if (frame.type === 'event') {
        this.enqueue(validateEvent(frame.event))
        return
      }

      if (frame.type === 'error') {
        const error = new Error(frame.error || 'kevent stream error')
        if (!acked) {
          rejectAck?.(error)
        } else {
          console.warn('kevent stream error:', error.message)
        }
      }
    }).then(() => {
      if (!acked) {
        rejectAck?.(new Error('kevent stream closed before ack'))
      }
    }).catch((error) => {
      if (!acked) {
        rejectAck?.(error instanceof Error ? error : new Error(toErrorMessage(error)))
        return
      }
      if (!this.controller.signal.aborted) {
        console.warn('kevent browser stream stopped with error:', error)
      }
    }).finally(() => {
      this.markClosed()
    })

    await ackPromise
  }

  private async consumeStream(
    body: ReadableStream<Uint8Array>,
    onFrame: (frame: KEventStreamFrame) => void,
  ): Promise<void> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (!this.controller.signal.aborted) {
        const { value, done } = await reader.read()
        if (done) {
          break
        }

        buffer += decoder.decode(value, { stream: true })
        buffer = this.processFrameBuffer(buffer, onFrame)
      }

      buffer += decoder.decode()
      buffer = this.processFrameBuffer(buffer, onFrame)
      if (buffer.trim().length > 0) {
        this.handleFrameLine(buffer, onFrame)
      }
    } finally {
      try {
        await reader.cancel()
      } catch {
        // Ignore cancellation failures during shutdown.
      }
    }
  }

  private processFrameBuffer(buffer: string, onFrame: (frame: KEventStreamFrame) => void): string {
    let cursor = buffer
    while (true) {
      const newlineIndex = cursor.indexOf('\n')
      if (newlineIndex < 0) {
        return cursor
      }

      const line = cursor.slice(0, newlineIndex)
      cursor = cursor.slice(newlineIndex + 1)
      this.handleFrameLine(line, onFrame)
    }
  }

  private handleFrameLine(line: string, onFrame: (frame: KEventStreamFrame) => void) {
    const trimmed = line.trim()
    if (!trimmed) {
      return
    }

    const frame = JSON.parse(trimmed) as KEventStreamFrame
    onFrame(frame)
  }

  protected async closeTransport(): Promise<void> {
    this.controller.abort()
    if (this.streamTask) {
      try {
        await this.streamTask
      } catch (error) {
        if (!this.controller.signal.aborted) {
          console.warn('kevent browser stream stopped with error:', error)
        }
      }
    }
  }
}

class NativeKEventProtocolClient {
  private socket: KEventNativeSocket | null = null
  private connectPromise: Promise<void> | null = null
  private closed = false
  private serial: Promise<void> = Promise.resolve()
  private readBuffer = new Uint8Array(0)
  private readonly pending: Array<{
    resolve: (value: KEventDaemonResponse) => void
    reject: (error: Error) => void
  }> = []

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly connectTimeoutMs: number,
    private readonly connector: KEventNativeConnector,
  ) {}

  async call(request: KEventDaemonRequest): Promise<KEventDaemonResponse> {
    const task = this.serial.then(() => this.callInternal(request))
    this.serial = task.then(() => undefined, () => undefined)
    return task
  }

  async close(): Promise<void> {
    this.closed = true
    this.rejectAllPending(new Error('kevent native connection closed'))
    if (this.socket) {
      const socket = this.socket
      this.socket = null
      socket.end()
    }
  }

  private async callInternal(request: KEventDaemonRequest): Promise<KEventDaemonResponse> {
    if (this.closed) {
      throw new Error('kevent native connection is closed')
    }

    await this.ensureConnected()
    const socket = this.socket
    if (!socket) {
      throw new Error('kevent native socket is not connected')
    }

    const payload = new TextEncoder().encode(JSON.stringify(request))
    if (payload.length === 0 || payload.length > MAX_NATIVE_FRAME_SIZE) {
      throw new Error(`invalid kevent native request payload size: ${payload.length}`)
    }

    const frame = new Uint8Array(4 + payload.length)
    const view = new DataView(frame.buffer)
    view.setUint32(0, payload.length)
    frame.set(payload, 4)

    return new Promise<KEventDaemonResponse>((resolve, reject) => {
      const pendingItem = { resolve, reject }
      this.pending.push(pendingItem)

      socket.write(frame, (error?: Error | null) => {
        if (!error) {
          return
        }

        const index = this.pending.indexOf(pendingItem)
        if (index >= 0) {
          this.pending.splice(index, 1)
        }
        reject(error instanceof Error ? error : new Error(toErrorMessage(error)))
      })
    })
  }

  private async ensureConnected(): Promise<void> {
    if (this.socket) {
      return
    }

    if (!this.connectPromise) {
      this.connectPromise = this.connect().finally(() => {
        this.connectPromise = null
      })
    }

    await this.connectPromise
  }

  private async connect(): Promise<void> {
    const socket = await this.connector(this.host, this.port, this.connectTimeoutMs)
    this.socket = socket
    if (typeof socket.setNoDelay === 'function') {
      socket.setNoDelay(true)
    }

    socket.on('data', (chunk: unknown) => {
      try {
        this.handleSocketData(toUint8Array(chunk))
      } catch (error) {
        this.handleSocketFailure(error instanceof Error ? error : new Error(toErrorMessage(error)))
      }
    })

    socket.once('end', () => {
      this.handleSocketFailure(new Error('kevent native socket ended'))
    })
    socket.once('close', () => {
      this.handleSocketFailure(new Error('kevent native socket closed'))
    })
    socket.once('error', (error: Error) => {
      this.handleSocketFailure(error)
    })
  }

  private handleSocketData(chunk: Uint8Array) {
    this.readBuffer = concatUint8Arrays(this.readBuffer, chunk)

    while (this.readBuffer.length >= 4) {
      const frameLength = new DataView(
        this.readBuffer.buffer,
        this.readBuffer.byteOffset,
        this.readBuffer.byteLength,
      ).getUint32(0)

      if (frameLength === 0 || frameLength > MAX_NATIVE_FRAME_SIZE) {
        throw new Error(`invalid kevent native frame length: ${frameLength}`)
      }

      if (this.readBuffer.length < 4 + frameLength) {
        return
      }

      const payloadBytes = this.readBuffer.slice(4, 4 + frameLength)
      this.readBuffer = this.readBuffer.slice(4 + frameLength)
      const response = JSON.parse(new TextDecoder().decode(payloadBytes)) as KEventDaemonResponse
      const pendingItem = this.pending.shift()
      if (!pendingItem) {
        continue
      }
      pendingItem.resolve(response)
    }
  }

  private handleSocketFailure(error: Error) {
    if (this.socket) {
      const socket = this.socket
      this.socket = null
      try {
        socket.destroy(error)
      } catch {
        // Ignore destroy failures during teardown.
      }
    }

    if (!this.closed) {
      this.rejectAllPending(error)
    }
  }

  private rejectAllPending(error: Error) {
    while (this.pending.length > 0) {
      const pendingItem = this.pending.shift()
      pendingItem?.reject(error)
    }
  }
}

class NativeKEventReader extends KEventReader {
  constructor(
    private readonly client: NativeKEventProtocolClient,
    private readonly readerId: string,
  ) {
    super()
  }

  static async create(
    patterns: string[],
    options: Required<Pick<KEventClientOptions, 'nativeHost' | 'nativePort' | 'nativeConnectTimeoutMs' | 'nativeConnector'>>,
  ): Promise<NativeKEventReader> {
    const client = new NativeKEventProtocolClient(
      options.nativeHost,
      options.nativePort,
      options.nativeConnectTimeoutMs,
      options.nativeConnector,
    )
    const readerId = generateReaderId()

    try {
      const response = await client.call({
        op: 'register_reader',
        reader_id: readerId,
        patterns,
      })
      assertDaemonResponseOk(response)
      return new NativeKEventReader(client, readerId)
    } catch (error) {
      await client.close()
      throw error
    }
  }

  async pullEvent(timeoutMs?: number): Promise<KEvent | null> {
    if (this.isClosed()) {
      return null
    }

    const response = await this.client.call({
      op: 'pull_event',
      reader_id: this.readerId,
      timeout_ms: typeof timeoutMs === 'number' ? Math.max(0, Math.floor(timeoutMs)) : undefined,
    })
    const ok = assertDaemonResponseOk(response)
    return ok.event ? validateEvent(ok.event) : null
  }

  protected async closeTransport(): Promise<void> {
    try {
      const response = await this.client.call({
        op: 'unregister_reader',
        reader_id: this.readerId,
      })
      assertDaemonResponseOk(response)
    } catch (error) {
      if (!(error instanceof Error) || !/closed/i.test(error.message)) {
        console.warn('kevent unregister failed:', error)
      }
    } finally {
      await this.client.close()
    }
  }
}

async function defaultNativeConnector(
  host: string,
  port: number,
  connectTimeoutMs: number,
): Promise<KEventNativeSocket> {
  if (!hasNodeRuntime()) {
    throw new Error('native kevent requires Node.js')
  }

  const net = await importNodeModule('node:net')

  return new Promise<KEventNativeSocket>((resolve, reject) => {
    const socket = net.createConnection({ host, port }) as KEventNativeSocket
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      try {
        socket.destroy(new Error(`kevent native connect timeout after ${connectTimeoutMs}ms`))
      } catch {
        // Ignore destroy failures while timeout is firing.
      }
      reject(new Error(`kevent native connect timeout after ${connectTimeoutMs}ms`))
    }, connectTimeoutMs)

    const onConnect = () => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolve(socket)
    }

    const onError = (error: Error) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      try {
        socket.destroy(error)
      } catch {
        // Ignore cleanup failure while connect fails.
      }
      reject(error)
    }

    const cleanup = () => {
      clearTimeout(timeout)
      if (typeof socket.off === 'function') {
        socket.off('connect', onConnect)
        socket.off('error', onError)
      } else if (typeof socket.removeListener === 'function') {
        socket.removeListener('connect', onConnect)
        socket.removeListener('error', onError)
      }
    }

    socket.once('connect', onConnect)
    socket.once('error', onError)
  })
}

function toUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value)
  }

  throw new Error('Unsupported socket data chunk')
}

function concatUint8Arrays(left: Uint8Array, right: Uint8Array): Uint8Array {
  const merged = new Uint8Array(left.length + right.length)
  merged.set(left, 0)
  merged.set(right, left.length)
  return merged
}

export class KEventClient {
  private readonly mode: KEventTransportMode
  private readonly streamUrl: string
  private readonly nativeHost: string
  private readonly nativePort: number
  private readonly nativeConnectTimeoutMs: number
  private readonly fetcher: KEventFetcher
  private readonly sessionTokenProvider: KEventSessionTokenProvider | null
  private readonly nativeConnector: KEventNativeConnector

  constructor(options: KEventClientOptions) {
    this.mode = options.mode
    this.streamUrl = buildStreamUrl(options.streamUrl ?? '/kapi/kevent')
    this.nativeHost = options.nativeHost ?? DEFAULT_NATIVE_HOST
    this.nativePort = options.nativePort ?? DEFAULT_NATIVE_PORT
    this.nativeConnectTimeoutMs = options.nativeConnectTimeoutMs ?? DEFAULT_NATIVE_CONNECT_TIMEOUT_MS
    this.fetcher = options.fetcher ?? defaultFetcher
    this.sessionTokenProvider = options.sessionTokenProvider ?? null
    this.nativeConnector = options.nativeConnector ?? defaultNativeConnector
  }

  async createEventReader(patterns: KEventPatternInput, options: KEventReaderOptions = {}): Promise<KEventReader> {
    const normalizedPatterns = normalizePatterns(patterns)

    if (this.mode === 'browser') {
      const reader = new BrowserKEventReader(
        this.streamUrl,
        normalizedPatterns,
        normalizeKeepaliveMs(options.keepaliveMs),
        this.fetcher,
        this.sessionTokenProvider,
        options.signal,
      )

      try {
        await reader.waitUntilReady()
        return reader
      } catch (error) {
        await reader.close()
        throw error
      }
    }

    return NativeKEventReader.create(normalizedPatterns, {
      nativeHost: this.nativeHost,
      nativePort: this.nativePort,
      nativeConnectTimeoutMs: this.nativeConnectTimeoutMs,
      nativeConnector: this.nativeConnector,
    })
  }

  async create_event_reader(patterns: KEventPatternInput, options: KEventReaderOptions = {}): Promise<KEventReader> {
    return this.createEventReader(patterns, options)
  }

  async subscribe(
    patterns: KEventPatternInput,
    callback: KEventCallback,
    options: KEventSubscribeOptions = {},
  ): Promise<KEventSubscription> {
    const normalizedPatterns = normalizePatterns(patterns)
    const abortController = new AbortController()
    const reconnectDelayMs = typeof options.reconnectDelayMs === 'number' && options.reconnectDelayMs >= 0
      ? Math.floor(options.reconnectDelayMs)
      : DEFAULT_SUBSCRIBE_RECONNECT_DELAY_MS
    let currentReader: KEventReader | null = null
    let closed = false

    if (options.signal) {
      if (options.signal.aborted) {
        abortController.abort()
        closed = true
      } else {
        options.signal.addEventListener('abort', () => {
          abortController.abort()
        }, { once: true })
      }
    }

    const run = (async () => {
      while (!closed && !abortController.signal.aborted) {
        try {
          currentReader = await this.createEventReader(normalizedPatterns, {
            ...options,
            signal: abortController.signal,
          })

          while (!closed && !abortController.signal.aborted) {
            const event = await currentReader.pullEvent()
            if (!event) {
              break
            }

            try {
              await callback(event)
            } catch (error) {
              console.error('kevent callback failed:', error)
            }
          }
        } catch (error) {
          if (!closed && !abortController.signal.aborted) {
            console.warn('kevent subscription disconnected, will retry:', error)
          }
        } finally {
          const reader = currentReader
          currentReader = null
          if (reader) {
            await reader.close()
          }
        }

        if (closed || abortController.signal.aborted) {
          break
        }

        try {
          await delay(reconnectDelayMs, abortController.signal)
        } catch {
          break
        }
      }
    })()

    return {
      close: async () => {
        if (closed) {
          return
        }

        closed = true
        abortController.abort()
        const reader = currentReader
        currentReader = null
        if (reader) {
          await reader.close()
        }
        await run.catch(() => undefined)
      },
    }
  }
}
