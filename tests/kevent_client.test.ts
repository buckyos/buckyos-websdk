import * as net from 'node:net'
import { once } from 'node:events'
import { KEventClient } from '../src/kevent_client'

function makeEvent(overrides: Partial<{
  eventid: string
  source_node: string
  source_pid: number
  ingress_node: string | null
  timestamp: number
  data: unknown
}> = {}) {
  return {
    eventid: '/system/node/online',
    source_node: 'node-a',
    source_pid: 1234,
    ingress_node: 'node-a',
    timestamp: 1700000000000,
    data: { ok: true },
    ...overrides,
  }
}

function encodeFrame(payload: unknown): Uint8Array {
  const json = Buffer.from(JSON.stringify(payload), 'utf8')
  const frame = Buffer.allocUnsafe(4 + json.length)
  frame.writeUInt32BE(json.length, 0)
  json.copy(frame, 4)
  return frame
}

function decodeFrames(buffer: Buffer): Array<{ payload: any; offset: number }> {
  const decoded: Array<{ payload: any; offset: number }> = []
  let offset = 0

  while (buffer.length - offset >= 4) {
    const length = buffer.readUInt32BE(offset)
    if (buffer.length - offset < 4 + length) {
      break
    }

    const payload = JSON.parse(buffer.slice(offset + 4, offset + 4 + length).toString('utf8'))
    offset += 4 + length
    decoded.push({ payload, offset })
  }

  return decoded
}

describe('KEventClient', () => {
  it('creates a browser reader over /kapi/kevent/stream and consumes event frames', async () => {
    const encoder = new TextEncoder()
    const event = makeEvent()
    const fetcher = jest.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'ack', connection_id: 'c1', keepalive_ms: 1234 })}\n`))
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'event', event })}\n`))
        controller.close()
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/x-ndjson' },
    }))

    const client = new KEventClient({
      mode: 'browser',
      streamUrl: '/kapi/kevent',
      fetcher,
      sessionTokenProvider: async () => 'session-token-1',
    })

    const reader = await client.create_event_reader(['/system/**'], { keepaliveMs: 1234 })
    const request = fetcher.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit]
    expect(request[0]).toBe('/kapi/kevent/stream')
    expect(request[1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer session-token-1',
      },
    })
    expect(JSON.parse((request[1] as RequestInit).body as string)).toEqual({
      patterns: ['/system/**'],
      keepalive_ms: 1234,
    })

    await expect(reader.pull_event(100)).resolves.toEqual(event)
    await expect(reader.pullEvent(0)).resolves.toBeNull()
    await reader.close()
  })

  it('creates a native reader over the tcp framed protocol', async () => {
    const requests: any[] = []
    const server = net.createServer((socket) => {
      let buffer = Buffer.alloc(0)

      socket.on('data', (chunk: Buffer | string) => {
        buffer = Buffer.concat([buffer, typeof chunk === 'string' ? Buffer.from(chunk) : chunk])
        const frames = decodeFrames(buffer)
        let consumed = 0

        for (const frame of frames) {
          consumed = frame.offset
          requests.push(frame.payload)

          if (frame.payload.op === 'register_reader') {
            socket.write(encodeFrame({ status: 'ok' }))
          } else if (frame.payload.op === 'pull_event') {
            socket.write(encodeFrame({
              status: 'ok',
              event: makeEvent({ eventid: '/system/node/ready' }),
            }))
          } else if (frame.payload.op === 'unregister_reader') {
            socket.write(encodeFrame({ status: 'ok' }))
          }
        }

        if (consumed > 0) {
          buffer = buffer.slice(consumed)
        }
      })
    })

    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('failed to resolve test server port')
    }

    const client = new KEventClient({
      mode: 'native',
      nativeHost: '127.0.0.1',
      nativePort: address.port,
    })

    const reader = await client.create_event_reader(['/system/**'])
    await expect(reader.pull_event(10)).resolves.toMatchObject({
      eventid: '/system/node/ready',
      source_node: 'node-a',
    })
    await reader.close()

    expect(requests).toHaveLength(3)
    expect(requests[0]).toMatchObject({
      op: 'register_reader',
      patterns: ['/system/**'],
    })
    expect(requests[1]).toEqual({
      op: 'pull_event',
      reader_id: requests[0].reader_id,
      timeout_ms: 10,
    })
    expect(requests[2]).toEqual({
      op: 'unregister_reader',
      reader_id: requests[0].reader_id,
    })

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
  })
})
