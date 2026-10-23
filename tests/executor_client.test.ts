import { encodeExecutorControl, ExecutorCommandStream, ExecutorOperationLocator, ExecutorRoute, ExecutorTarget } from '../src/executor_client'

const target: ExecutorTarget = { executor_id: 'exec-1', generation: 2, profile_id: 'user', store_id: 'ledger-1' }
const route: ExecutorRoute = { ...target, stream_id: 'stream-1', ws_url: 'wss://zone.invalid/route/1', ticket: 'secret-ticket', expires_at_ms: Date.now() + 600000 }
const locator: ExecutorOperationLocator = { ...target, op_id: 'op-1', run_id: 'run-1', call_id: 'call-1' }

class Socket {
  static instances: Socket[] = []
  onopen?: () => void
  onmessage?: (event: { data: string | ArrayBuffer }) => void
  onclose?: () => void
  onerror?: () => void
  binaryType = ''
  sent: Array<Record<string, unknown>> = []
  constructor(readonly url: URL) { Socket.instances.push(this); queueMicrotask(() => this.onopen?.()) }
  close(): void {}
  send(data: string | Uint8Array): void {
    if (typeof data === 'string') {
      expect(JSON.parse(data)).toEqual({ ticket: 'secret-ticket' })
      queueMicrotask(() => this.onmessage?.({ data: '{"ready":true}' }))
      return
    }
    if (data[0] !== 1) return
    const message = JSON.parse(new TextDecoder().decode(data.subarray(5)))
    this.sent.push(message)
    const reply = encodeExecutorControl({ type: message.type === 'login' ? 'login_ok' : 'query_ok', request_id: message.request_id, store_id: 'ledger-1', op: { state: 'succeeded' } })
    queueMicrotask(() => {
      this.onmessage?.({ data: reply.slice(0, 3).buffer })
      this.onmessage?.({ data: reply.slice(3).buffer })
    })
  }
}

const originalSocket = global.WebSocket
beforeEach(() => { Socket.instances = []; global.WebSocket = Socket as unknown as typeof WebSocket })
afterEach(() => { global.WebSocket = originalSocket })

test('control framing matches Rust big-endian Command Stream and handles partial websocket frames', async () => {
  const encoded = encodeExecutorControl({ type: 'ping', request_id: 'x' })
  expect(encoded[0]).toBe(1)
  expect(new DataView(encoded.buffer).getUint32(1)).toBe(encoded.length - 5)
  const stream = await ExecutorCommandStream.connect(route, target, 'app-session', 'runtime', 'run-1')
  expect((await stream.query(locator)).op?.state).toBe('succeeded')
  expect(Socket.instances[0].sent[0]).toMatchObject({ type: 'login', token: 'app-session', profile: 'user' })
  stream.close()
})

test('stale route and changed ledger never dispatch operations', async () => {
  await expect(ExecutorCommandStream.connect({ ...route, generation: 3 }, target, 'token', 'runtime', 'run')).rejects.toThrow('Route does not match')
  expect(Socket.instances).toHaveLength(0)
  await expect(ExecutorCommandStream.connect(route, { ...target, store_id: 'different' }, 'token', 'runtime', 'run')).rejects.toThrow('ledger changed')
  expect(Socket.instances[0].sent.map(value => value.type)).toEqual(['login'])
})

test('old generation may query same ledger but cannot dispatch a new action', async () => {
  const stream = await ExecutorCommandStream.connect(route, target, 'token', 'runtime', 'run-1')
  const old = { ...locator, generation: 1 }
  await stream.query(old)
  expect(() => stream.exec(old, 'touch file', '/tmp')).toThrow('old operation')
  expect(() => stream.query({ ...old, store_id: 'wrong-ledger' })).toThrow('another executor')
  expect(Socket.instances[0].sent.map(value => value.type)).toEqual(['login', 'query'])
  stream.close()
})

test('disconnection does not silently reconnect or replay the operation', async () => {
  const stream = await ExecutorCommandStream.connect(route, target, 'token', 'runtime', 'run-1')
  const socket = Socket.instances[0]
  socket.send = (data) => { if (typeof data !== 'string') queueMicrotask(() => socket.onclose?.()) }
  await expect(stream.exec(locator, 'touch file', '/tmp')).rejects.toMatchObject({ effectUnknown: true })
  expect(Socket.instances).toHaveLength(1)
})
