import { contentDescriptor, contentRefString, isTransferableRef, parentSource, parseObjRefString, parseSystemOpen, systemOpenUrl } from '../src/content'
import { archiveExtensionOf, archiveInnerPath, archiveObjectRef, archivePath, NfspClient } from '../src/nfsp'
import { formatObjectUrl, parseObjectUrl } from '../src/object_url'

describe('archive member references', () => {
  const member = { kind: 'object-id' as const, objectId: 'cyfile:abc123', innerPath: '/archive/文档 #1/a b%.txt' }

  it('round-trips an object member through obj:// and the system open URL', () => {
    const text = contentRefString(member)
    expect(text).toBe('obj://cyfile:abc123/archive/%E6%96%87%E6%A1%A3%20%231/a%20b%25.txt')
    expect(parseObjRefString(text)).toEqual(member)
    expect(contentRefString({ kind: 'object-id', objectId: 'cyfile:abc123' })).toBe('obj://cyfile:abc123')
    const url = new URL(systemOpenUrl('https://zone.example', { request: { source: member }, target: 'preview', hints: { name: 'a b%.txt' } }))
    expect(parseSystemOpen(url.searchParams)?.request.source).toEqual(member)
  })

  it('validates inner paths', () => {
    expect(isTransferableRef(member)).toBe(true)
    expect(isTransferableRef({ ...member, innerPath: '/archive' })).toBe(true)
    for (const bad of ['/content/a', '/archive/', '/archive/../x', '/archive/a//b', 'archive/a', '/archive/a\\b']) {
      expect(isTransferableRef({ ...member, innerPath: bad })).toBe(false)
    }
    expect(parseSystemOpen(new URLSearchParams('open=obj://cyfile:abc/content/x'))).toBeUndefined()
  })

  it('names the member, keeps it a file and walks up to the archive root', () => {
    expect(contentDescriptor(member)).toMatchObject({ name: 'a b%.txt', ext: '.txt', objType: 'cyfile' })
    expect(parentSource(member)).toEqual({ ...member, innerPath: '/archive/文档 #1' })
    expect(parentSource({ ...member, innerPath: '/archive' })).toBeUndefined()
  })

  it('builds NFSP refs and addresses', () => {
    expect(archiveInnerPath('')).toBe('/archive')
    expect(archiveInnerPath('/docs/a.txt')).toBe('/archive/docs/a.txt')
    expect(archiveObjectRef('cyfile:x', 'docs')).toEqual({ type: 'object', obj_id: 'cyfile:x', inner_path: '/archive/docs' })
    expect(archivePath('cyfs:///home/alice/a.zip')).toBe('cyfs:///home/alice/a.zip/@/archive')
    expect(archivePath('cyfs:///home/alice/a.zip', 'docs/a.txt')).toBe('cyfs:///home/alice/a.zip/@/archive/docs/a.txt')
  })

  it('keeps /@/archive/ paths unchanged through the object url rules', () => {
    for (const path of ['cyfs:///home/alice/a.zip/@/archive', 'cyfs:///home/alice/a.zip/@/archive/@/x.txt']) {
      expect(formatObjectUrl(parseObjectUrl(path))).toBe(path)
    }
  })

  it('opens archives the server lists in hello', async () => {
    const fetch = (async () => new Response(JSON.stringify({ ok: true, result: { session: 's', version: 'nfsp/0', features: [], limits: {}, realms: [],
      archive: { available: true, formats: [{ format: 'zip', extensions: ['zip'], methods: ['stored'], encryption: [] }] } } }))) as unknown as typeof globalThis.fetch
    const client = new NfspClient({ baseUrl: 'http://x', fetch })
    expect(client.opensArchive('a.zip')).toBe(false)
    await client.hello()
    expect(client.opensArchive('A.ZIP')).toBe(true)
    expect(client.opensArchive('a.docx')).toBe(false)
    expect(client.opensArchive('zip')).toBe(false)
    expect(client.opensArchive('a.tar.gz')).toBe(false)
  })

  it('matches the longest archive extension', () => {
    const exts = ['zip', 'tar', 'tar.gz', 'tgz', 'gz', '7z']
    expect(archiveExtensionOf('Backup.TAR.GZ', exts)).toBe('tar.gz')
    expect(archiveExtensionOf('server.log.gz', exts)).toBe('gz')
    expect(archiveExtensionOf('photos.7z', exts)).toBe('7z')
    expect(archiveExtensionOf('a.tgz', exts)).toBe('tgz')
    expect(archiveExtensionOf('.tar.gz', exts)).toBe('gz')
    expect(archiveExtensionOf('tar.gz', exts)).toBe('gz')
    expect(archiveExtensionOf('.gz', exts)).toBeNull()
    expect(archiveExtensionOf('a.docx', exts)).toBeNull()
  })
})
