import { kRPCClient } from '../src/krpc_client'
import { BucketClient, BucketError, bucketDataPlaneBase, bucketObjectPath, bucketObjUrl, parseBucketObjUrl, parseBucketPath, userBucketId, zoneBucketId } from '../src/bucket_client'

function rpcResponse(body: unknown, seq: number = 1) {
  return { ok: true, status: 200, json: async () => ({ result: body, sys: [seq] }) }
}

function bodyOf(fetcher: jest.Mock, callIdx = 0) {
  return JSON.parse((fetcher.mock.calls[callIdx][1] as RequestInit).body as string)
}

describe('BucketClient', () => {
  it('builds and parses bucket ids and obj://bucket urls', () => {
    expect(userBucketId('photos', 'alice', 'library')).toBe('user/photos/alice/library')
    expect(zoneBucketId('msg-center', 'attachments')).toBe('zone/msg-center/_/attachments')
    expect(() => userBucketId('photos', '_', 'library')).toThrow(BucketError)
    expect(() => userBucketId('a/b', 'alice', 'library')).toThrow(BucketError)
    expect(parseBucketPath('zone/msg-center/_/attachments/s/1/0')).toEqual({ bucketId: 'zone/msg-center/_/attachments', parts: { scope: 'zone', appid: 'msg-center', owner: '_', name: 'attachments' }, key: 's/1/0' })
    expect(parseBucketPath('zone/msg-center/alice/attachments')).toBeNull()
    expect(parseBucketPath('user/x/a')).toBeNull()
    const url = bucketObjUrl('user/photos/alice/library', '2026/a.jpg')
    expect(url).toBe('obj://bucket/user/photos/alice/library/2026/a.jpg')
    expect(parseBucketObjUrl(url)).toEqual({ bucketId: 'user/photos/alice/library', key: '2026/a.jpg' })
    expect(parseBucketObjUrl('obj://bucket/user/photos/alice/library')).toBeNull()
    expect(parseBucketObjUrl('cyfile:abc')).toBeNull()
  })

  it('derives the data plane from the service URL', () => {
    expect(bucketDataPlaneBase('/kapi/nfs-server/')).toBe('')
    expect(bucketDataPlaneBase('https://zone.example/kapi/nfs-server')).toBe('https://zone.example')
    expect(bucketDataPlaneBase('http://127.0.0.1:3180/kapi/nfs-server')).toBe('http://127.0.0.1:3180')
    expect(bucketObjectPath('user/photos/alice/library', '2026/a b.jpg')).toBe('/bucket/v1/user/photos/alice/library/2026/a%20b.jpg')
  })

  it('sends bucket.* with the bucket id and request fields', async () => {
    const fetcher = jest.fn().mockResolvedValue(rpcResponse({ version: 3, etag: 'cyfile:aa', created: true }))
    const client = new BucketClient(new kRPCClient('/kapi/nfs-server/', null, 1, { fetcher }))
    const r = await client.put('user/photos/alice/library', { key: 'a.jpg', obj_id: 'cyfile:aa', if_none_match: '*' })
    expect(r.version).toBe(3)
    expect(bodyOf(fetcher)).toEqual({
      method: 'bucket.put',
      params: { bucket_id: 'user/photos/alice/library', key: 'a.jpg', obj_id: 'cyfile:aa', if_none_match: '*' },
      sys: [1],
    })
  })

  it('releases an app and deletes a bucket with an explicit session token', async () => {
    const release = { appid: 'photos', owner: 'alice', buckets: [{ bucket_id: 'user/photos/alice/library', data_policy: 'documents', unique_bytes: 5, action: 'orphaned' }] }
    const fetcher = jest.fn()
      .mockResolvedValueOnce(rpcResponse(release))
      .mockResolvedValueOnce(rpcResponse({ deleted: true }, 2))
      .mockResolvedValueOnce(rpcResponse({ deleted: true }, 3))
    const client = new BucketClient(new kRPCClient('/kapi/nfs-server/', 'session', 1, { fetcher }))
    expect(await client.releaseApp('photos', 'alice')).toEqual(release)
    expect(bodyOf(fetcher)).toEqual({ method: 'bucket.release_app', params: { appid: 'photos', owner: 'alice', keep_app_data: false }, sys: [1, 'session'] })
    expect(await client.deleteBucket('user/photos/alice/library', { sessionToken: 'sudo' })).toEqual({ deleted: true })
    expect(bodyOf(fetcher, 1)).toEqual({ method: 'bucket.delete_bucket', params: { bucket_id: 'user/photos/alice/library' }, sys: [2, 'sudo'] })
    await client.deleteBucket('user/photos/alice/index', { sessionToken: null })
    expect(bodyOf(fetcher, 2).sys).toEqual([3, 'session'])
  })

  it('PUTs bytes with metadata, conditions and the session token', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ obj_id: 'cyfile:bb', version: 1, etag: 'cyfile:bb', created: true }),
    })
    const client = new BucketClient(new kRPCClient('/kapi/nfs-server/', null, 1, { fetcher: jest.fn() }), {
      dataPlaneBase: 'https://zone.example',
      sessionTokenProvider: async () => 'tok',
      fetcher: fetcher as unknown as typeof fetch,
    })
    const r = await client.putBytes('user/photos/alice/library', 'x/a.txt', 'hello', {
      contentType: 'text/plain',
      metadata: { album: 'trip' },
      if_none_match: '*',
      expiresAt: 123,
    })
    expect(r.obj_id).toBe('cyfile:bb')
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://zone.example/bucket/v1/user/photos/alice/library/x/a.txt')
    expect(init.method).toBe('PUT')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer tok',
      'Content-Type': 'text/plain',
      'x-bucky-meta-album': 'trip',
      'If-None-Match': '*',
      'x-bucky-expires-at': '123',
    })
  })

  it('maps data-plane errors to BucketError with their code', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: false,
      status: 507,
      statusText: 'Insufficient Storage',
      text: async () => JSON.stringify({ error: 'quota_exceeded', message: 'quota exceeded', data: { level: 'bucket' } }),
    })
    const client = new BucketClient(new kRPCClient('/kapi/nfs-server/', null, 1, { fetcher: jest.fn() }), {
      dataPlaneBase: '',
      fetcher: fetcher as unknown as typeof fetch,
    })
    await expect(client.putBytes('user/a/b/c', 'k', 'x')).rejects.toMatchObject({ code: 'quota_exceeded', status: 507, data: { level: 'bucket' } })
    await expect(client.putBytes('user/a/b/c', 'k', 'x')).rejects.toBeInstanceOf(BucketError)
    expect(client.objectUrl('user/a/b/c', 'k', { token: 'bkt_1', version: 2 })).toBe('/bucket/v1/user/a/b/c/k?version=2&token=bkt_1')
  })
})
