import { kRPCClient, KRPCClientOptions } from './krpc_client'

export type ExecutorOperation = 'open_stream' | 'describe' | 'exec' | 'read' | 'write' | 'edit' | 'mkdir' | 'stat' | 'rename' | 'remove' | 'computer_inspect' | 'computer_observe' | 'computer_act' | 'query' | 'cancel'
export interface ExecutorProfile {
  run_as?: { uid: number; gid: number }
  workdir_roots: string[]
  env?: Record<string, string>
  principals: string[]
  ops: ExecutorOperation[]
}
export interface ExecutorDevice {
  executor_id: string
  name: string
  owner_user_id: string
  enabled: boolean
  expires_at_ms: number | null
  generation: number
  profiles: Record<string, ExecutorProfile>
  limits: Record<string, number>
  created_at_ms: number
}
export interface ExecutorOnlineTarget {
  executor_id: string
  name: string
  generation: number
  store_id: string
  profiles: string[]
  capabilities: Record<string, unknown>
  expires_at_ms: number | null
}
export interface ExecutorTarget {
  executor_id: string
  generation: number
  profile_id: string
  store_id: string
}
export interface ExecutorRoute {
  executor_id: string
  generation: number
  profile_id: string
  stream_id: string
  ws_url: string
  ticket: string
  expires_at_ms: number
}
export interface ExecutorAccess {
  device: ExecutorDevice
  access_url: string
  start_command: string
}
export interface ExecutorOperationLocator extends ExecutorTarget {
  op_id: string
  run_id: string
  call_id: string
}
export interface ExecutorReply {
  type: string
  request_id?: string
  store_id?: string
  op?: { state: string; [key: string]: unknown }
  chunk?: { data_b64: string; offset: number; eof: boolean } | null
  error?: { code: string; message: string; effect_unknown?: boolean }
  [key: string]: unknown
}

export class ExecutorClient {
  private readonly rpc: kRPCClient
  constructor(serviceUrl: string, token: string | null = null, options: KRPCClientOptions = {}) {
    this.rpc = new kRPCClient(serviceUrl, token, null, options)
  }
  syncSessionToken(token: string | null): void { this.rpc.setSessionToken(token) }
  createDevice(input: { name: string; profiles: Record<string, ExecutorProfile>; limits?: Record<string, number>; expires_at_ms?: number }): Promise<ExecutorAccess> {
    return this.rpc.call('executor.device.create', input)
  }
  listDevices(): Promise<{ devices: Array<{ device: ExecutorDevice; online: ExecutorOnlineTarget | null }> }> {
    return this.rpc.call('executor.device.list', {})
  }
  issueAccess(executor_id: string, expires_at_ms?: number): Promise<ExecutorAccess> {
    return this.rpc.call('executor.device.issue', { executor_id, expires_at_ms })
  }
  revokeAccess(executor_id: string): Promise<Record<string, never>> {
    return this.rpc.call('executor.device.revoke', { executor_id })
  }
  deleteDevice(executor_id: string): Promise<Record<string, never>> {
    return this.rpc.call('executor.device.delete', { executor_id })
  }
  listOnline(): Promise<{ executors: ExecutorOnlineTarget[] }> {
    return this.rpc.call('executor.online.list', {})
  }
  async *watchOnline(signal?: AbortSignal, intervalMs = 5000): AsyncGenerator<ExecutorOnlineTarget[]> {
    if (intervalMs < 250) throw new Error('Watch interval must be at least 250 ms')
    let previous = ''
    while (!signal?.aborted) {
      const { executors } = await this.listOnline()
      const next = JSON.stringify(executors)
      if (next !== previous) { previous = next; yield executors }
      await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve() }
        const timer = setTimeout(done, intervalMs)
        signal?.addEventListener('abort', done, { once: true })
        if (signal?.aborted) done()
      })
    }
  }
  openRoute(target: ExecutorTarget): Promise<ExecutorRoute> {
    return this.rpc.call('executor.stream.open', {
      executor_id: target.executor_id, generation: target.generation, profile_id: target.profile_id,
    })
  }
  async connect(target: ExecutorTarget, sessionToken: string, runtimeId: string, runId: string): Promise<ExecutorCommandStream> {
    const route = await this.openRoute(target)
    return ExecutorCommandStream.connect(route, target, sessionToken, runtimeId, runId)
  }
}

export class ExecutorStreamError extends Error {
  constructor(message: string, readonly code = 'unavailable', readonly effectUnknown = false) {
    super(message)
    this.name = 'ExecutorStreamError'
  }
}

export function encodeExecutorControl(message: Record<string, unknown>): Uint8Array {
  const payload = new TextEncoder().encode(JSON.stringify(message))
  if (payload.length > 1024 * 1024) throw new Error('Executor control frame exceeds 1 MiB')
  const frame = new Uint8Array(5 + payload.length)
  frame[0] = 1
  new DataView(frame.buffer).setUint32(1, payload.length)
  frame.set(payload, 5)
  return frame
}

export class ExecutorCommandStream {
  private buffer = new Uint8Array()
  private sequence = 0
  private readonly pending = new Map<string, { resolve: (reply: ExecutorReply) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private closed = false
  private constructor(private readonly socket: WebSocket, readonly target: ExecutorTarget, readonly runId: string) {
    socket.binaryType = 'arraybuffer'
    socket.onmessage = (event) => {
      if (!(event.data instanceof ArrayBuffer)) { this.fail(new ExecutorStreamError('Expected binary Command Stream')); return }
      try { this.receive(new Uint8Array(event.data)) } catch { this.fail(new ExecutorStreamError('Invalid Command Stream frame', 'protocol')) }
    }
    socket.onclose = () => this.fail(new ExecutorStreamError('Executor disconnected; query the persisted operation locator before taking further action', 'unavailable', true))
    socket.onerror = () => this.fail(new ExecutorStreamError('Executor transport failed', 'unavailable', true))
  }
  static async connect(route: ExecutorRoute, target: ExecutorTarget, token: string, runtimeId: string, runId: string): Promise<ExecutorCommandStream> {
    if (route.executor_id !== target.executor_id || route.generation !== target.generation || route.profile_id !== target.profile_id || route.expires_at_ms <= Date.now()) {
      throw new ExecutorStreamError('Route does not match the requested active executor', 'stale_target')
    }
    const url = new URL(route.ws_url)
    if (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
      throw new ExecutorStreamError('Executor routes require WSS')
    }
    if (url.username || url.password || url.hash) throw new ExecutorStreamError('Invalid executor route URL')
    const socket = new WebSocket(url)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new ExecutorStreamError('Route authentication timed out')) }, 10000)
      socket.onopen = () => socket.send(JSON.stringify({ ticket: route.ticket }))
      socket.onmessage = (event) => {
        try {
          if (typeof event.data !== 'string' || JSON.parse(event.data).ready !== true) throw new Error()
          clearTimeout(timer)
          resolve()
        } catch { clearTimeout(timer); socket.close(); reject(new ExecutorStreamError('Route authentication failed')) }
      }
      socket.onerror = socket.onclose = () => { clearTimeout(timer); reject(new ExecutorStreamError('Unable to connect executor route')) }
    })
    const client = new ExecutorCommandStream(socket, target, runId)
    try {
      const login = await client.request('login', { v: 1, token, profile: target.profile_id, client: { runtime_id: runtimeId, run_id: runId } })
      if (login.type !== 'login_ok' || login.store_id !== target.store_id) throw new ExecutorStreamError('Executor ledger changed', 'store_mismatch')
      return client
    } catch (error) { client.close(); throw error }
  }
  private receive(bytes: Uint8Array): void {
    const merged = new Uint8Array(this.buffer.length + bytes.length)
    merged.set(this.buffer); merged.set(bytes, this.buffer.length); this.buffer = merged
    while (this.buffer.length >= 5) {
      const length = new DataView(this.buffer.buffer, this.buffer.byteOffset).getUint32(1)
      if (length > 1024 * 1024 || ![1, 2].includes(this.buffer[0])) throw new Error()
      if (this.buffer.length < length + 5) return
      const kind = this.buffer[0]
      const payload = this.buffer.slice(5, length + 5)
      this.buffer = this.buffer.slice(length + 5)
      if (kind !== 1) continue
      const reply = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload)) as ExecutorReply
      if (reply.type === 'closing') { this.fail(new ExecutorStreamError('Executor stopped accepting requests')); return }
      const pending = reply.request_id && this.pending.get(reply.request_id)
      if (!pending) continue
      this.pending.delete(reply.request_id!); clearTimeout(pending.timer)
      if (reply.error) pending.reject(new ExecutorStreamError(reply.error.message, reply.error.code, reply.error.effect_unknown))
      else pending.resolve(reply)
    }
  }
  private fail(error: Error): void {
    if (this.closed) return
    this.closed = true
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error) }
    this.pending.clear(); this.socket.close()
  }
  close(): void { this.fail(new ExecutorStreamError('Executor stream closed', 'unavailable', true)) }
  request(type: string, params: Record<string, unknown> = {}, timeoutMs = 40000): Promise<ExecutorReply> {
    if (this.closed) return Promise.reject(new ExecutorStreamError('Executor stream is closed'))
    const request_id = `q${++this.sequence}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request_id)
        reject(new ExecutorStreamError('Executor response timed out; query operation before retrying', 'unavailable', true))
      }, timeoutMs)
      this.pending.set(request_id, { resolve, reject, timer })
      try { this.socket.send(encodeExecutorControl({ ...params, type, request_id })) }
      catch { clearTimeout(timer); this.pending.delete(request_id); reject(new ExecutorStreamError('Unable to send request', 'unavailable', true)) }
    })
  }
  private operation(locator: ExecutorOperationLocator): Record<string, unknown> {
    if (locator.executor_id !== this.target.executor_id || locator.store_id !== this.target.store_id || locator.profile_id !== this.target.profile_id) {
      throw new ExecutorStreamError('Operation locator belongs to another executor, profile or ledger', 'store_mismatch')
    }
    return { store_id: locator.store_id, op_id: locator.op_id, run_id: locator.run_id, call_id: locator.call_id }
  }
  private fresh(locator: ExecutorOperationLocator): Record<string, unknown> {
    if (locator.generation !== this.target.generation) throw new ExecutorStreamError('Cannot dispatch an old operation to a new connection generation', 'stale_target')
    return this.operation(locator)
  }
  async describe(workdir?: string): Promise<ExecutorReply> {
    const reply = await this.request('describe', { workdir })
    const described = reply.target as { executor_id?: string; node_did?: string; profile_id?: string; store_id?: string } | undefined
    if (reply.type !== 'describe_ok' || described?.executor_id !== this.target.executor_id || described?.node_did || described?.profile_id !== this.target.profile_id || described?.store_id !== this.target.store_id) {
      throw new ExecutorStreamError('Executor describe target changed', 'stale_target')
    }
    return reply
  }
  exec(locator: ExecutorOperationLocator, cmd: string, cwd: string, env_overrides: Record<string, string> = {}, execution_timeout_ms = 60000): Promise<ExecutorReply> {
    return this.request('exec', { ...this.fresh(locator), cmd, cwd, env_overrides, execution_timeout_ms })
  }
  read(locator: ExecutorOperationLocator, path: string): Promise<ExecutorReply> {
    return this.request('read', { ...this.fresh(locator), path, offset: 0 })
  }
  edit(locator: ExecutorOperationLocator, path: string, edits: Array<{ old_string: string; new_string: string; replace_all?: boolean }>): Promise<ExecutorReply> {
    return this.request('edit', { ...this.fresh(locator), path, edits })
  }
  async write(locator: ExecutorOperationLocator, path: string, content: Uint8Array, mode: 'replace' | 'append' | 'create_new' = 'replace'): Promise<ExecutorReply> {
    const operation = this.fresh(locator)
    const id = new TextEncoder().encode(locator.op_id)
    if (id.length === 0 || id.length > 128) throw new Error('Invalid operation ID')
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', content))).map(value => value.toString(16).padStart(2, '0')).join('')
    const accepted = this.request('write', { ...operation, path, mode, content_length: content.length, content_hash: `sha256:${hash}` })
    for (let offset = 0; offset < content.length; offset += 16384) {
      const chunk = content.subarray(offset, offset + 16384)
      const frame = new Uint8Array(16 + id.length + chunk.length)
      const view = new DataView(frame.buffer)
      frame[0] = 2; view.setUint32(1, frame.length - 5); frame[5] = 4
      view.setBigUint64(6, BigInt(offset)); view.setUint16(14, id.length)
      frame.set(id, 16); frame.set(chunk, 16 + id.length)
      this.socket.send(frame)
    }
    this.socket.send(encodeExecutorControl({ type: 'upload_end', request_id: `end${++this.sequence}`, op_id: locator.op_id }))
    return accepted
  }
  query(locator: ExecutorOperationLocator, channel?: 'stdout' | 'stderr' | 'content', offset = 0, wait_ms = 0): Promise<ExecutorReply> {
    this.operation(locator)
    return this.request('query', { store_id: locator.store_id, op_id: locator.op_id, channel, offset, max_bytes: 262144, wait_ms })
  }
  cancel(locator: ExecutorOperationLocator): Promise<ExecutorReply> {
    this.operation(locator)
    return this.request('cancel', { store_id: locator.store_id, op_id: locator.op_id })
  }
}
