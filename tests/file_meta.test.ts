import * as fs from 'fs'
import * as path from 'path'
import { FileObject } from '../src/ndn_types'
import { buildFileObject, FILE_META_READ_LIMIT, probeFileMeta, type FileMetaSource } from '../src/file_meta'
import { heifImageSize, sniffMagic, stripMediaTypeParams } from '../src/content_mime'

interface MetaVector {
  name: string
  input: string
  file_name?: string
  declared_mime?: string
  expected: Record<string, unknown>
}

// Printed by `test_media_meta_vectors` of cyfs-ndn ndn-lib, the reference implementation.
const VECTORS = JSON.parse(fs.readFileSync(path.join(__dirname, 'media_meta_vectors.json'), 'utf8')) as MetaVector[]

function memorySource(bytes: Uint8Array): FileMetaSource {
  return {
    size: bytes.length,
    readAt(offset, length) {
      if (offset + length > bytes.length) throw new Error('out of range')
      return bytes.subarray(offset, offset + length)
    },
  }
}

describe('probeFileMeta vectors', () => {
  it('holds the expected set', () => {
    expect(VECTORS.length).toBeGreaterThan(100)
    expect(new Set(VECTORS.map(vector => vector.name)).size).toBe(VECTORS.length)
  })

  for (const vector of VECTORS) {
    it(vector.name, async () => {
      const bytes = new Uint8Array(Buffer.from(vector.input, 'base64'))
      const options = { name: vector.file_name ?? '', declaredMime: vector.declared_mime }
      expect(await probeFileMeta(memorySource(bytes), options)).toEqual(vector.expected)
      // The same bytes behind a Blob take the slice path. There is no DOM here,
      // so no media element fills anything in.
      expect(await probeFileMeta(new Blob([bytes]), options)).toEqual(vector.expected)
    })
  }
})

describe('probeFileMeta bounds', () => {
  function sparseSource(pieces: Array<[number, Uint8Array]>, size: number) {
    const reads: number[] = []
    const source: FileMetaSource = {
      size,
      readAt(offset, length) {
        reads.push(length)
        const out = new Uint8Array(length)
        for (const [start, data] of pieces) {
          for (let i = 0; i < data.length; i += 1) {
            const at = start + i
            if (at >= offset && at < offset + length) out[at - offset] = data[i]
          }
        }
        return out
      },
    }
    return { source, reads }
  }

  it('a 40 GiB MP4 with its moov at the end costs a few windows', async () => {
    const box = (type: string, ...payload: Uint8Array[]) => {
      const body = Buffer.concat(payload)
      const head = Buffer.alloc(8)
      head.writeUInt32BE(body.length + 8, 0)
      head.write(type, 4, 'latin1')
      return new Uint8Array(Buffer.concat([head, body]))
    }
    const ftyp = box('ftyp', Buffer.from('isom\0\0\0\0'))
    const mdatHead = Buffer.alloc(16)
    mdatHead.writeUInt32BE(1, 0)
    mdatHead.write('mdat', 4, 'latin1')
    mdatHead.writeBigUInt64BE(40_000_000_000n, 8)
    const moovAt = ftyp.length + 40_000_000_000

    const mvhdBody = Buffer.alloc(100)
    mvhdBody.writeUInt32BE(1000, 12)
    mvhdBody.writeUInt32BE(60000, 16)
    const mvhd = box('mvhd', mvhdBody)
    const tkhdBody = Buffer.alloc(84)
    tkhdBody.writeInt32BE(0x10000, 40)
    tkhdBody.writeInt32BE(0x10000, 56)
    tkhdBody.writeUInt32BE(3840 * 65536, 76)
    tkhdBody.writeUInt32BE(2160 * 65536, 80)
    const tkhd = box('tkhd', tkhdBody)
    const hdlrBody = Buffer.alloc(24)
    hdlrBody.write('vide', 8, 'latin1')
    const hdlr = box('hdlr', hdlrBody)
    const stsdBody = Buffer.alloc(8)
    stsdBody.writeUInt32BE(1, 4)
    const stsd = box('stsd', stsdBody, box('avc1', Buffer.alloc(8)))
    // `stsz` claims 2 GB and only its header exists in the sparse source.
    const tableSize = 2_000_000_000
    const stszHead = Buffer.alloc(8)
    stszHead.writeUInt32BE(tableSize + 8, 0)
    stszHead.write('stsz', 4, 'latin1')
    const wrap = (type: string, extra: number, ...payload: Uint8Array[]) => {
      const body = Buffer.concat(payload)
      const head = Buffer.alloc(8)
      head.writeUInt32BE(body.length + 8 + extra, 0)
      head.write(type, 4, 'latin1')
      return new Uint8Array(Buffer.concat([head, body]))
    }
    const stbl = wrap('stbl', tableSize, stsd, stszHead)
    const minf = wrap('minf', tableSize, stbl)
    const mdia = wrap('mdia', tableSize, hdlr, minf)
    const trak = wrap('trak', tableSize, tkhd, mdia)
    const moov = wrap('moov', tableSize, mvhd, trak)

    const { source, reads } = sparseSource(
      [[0, new Uint8Array(Buffer.concat([ftyp, mdatHead]))], [moovAt, moov]],
      moovAt + moov.length + tableSize,
    )
    const meta = await probeFileMeta(source, { name: 'big.mp4' })
    expect(meta).toEqual({ mime: 'video/mp4', width: 3840, height: 2160, duration_ms: 60000, video_codec: 'h264' })
    expect(reads.reduce((sum, length) => sum + length, 0)).toBeLessThanOrEqual(4 * 64 * 1024)
  })

  it('stops at the read limit and keeps the mime', async () => {
    const head = Buffer.alloc(24)
    head.writeUInt32BE(16, 0)
    head.write('ftypheic', 4, 'latin1')
    head.writeUInt32BE(100_000_000, 16)
    head.write('meta', 20, 'latin1')
    const { source, reads } = sparseSource([[0, new Uint8Array(head)]], 200_000_000)
    expect(await probeFileMeta(source, { name: 'a.heic' })).toEqual({ mime: 'image/heic' })
    expect(reads.reduce((sum, length) => sum + length, 0)).toBeLessThanOrEqual(FILE_META_READ_LIMIT)
  })

  it('a failing source only loses the parsed fields', async () => {
    const source: FileMetaSource = {
      size: 1000,
      readAt: () => Promise.reject(new Error('io')),
    }
    expect(await probeFileMeta(source, { name: 'a.jpg' })).toEqual({ mime: 'image/jpeg' })
  })

  it('never throws on random bytes behind any media type', async () => {
    let seed = 12345
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed & 0xff
    }
    const prefixes = [[0xff, 0xd8, 0xff], [0x89, 0x50, 0x4e, 0x47], [0x49, 0x49, 0x2a, 0], [0x4d, 0x4d, 0, 0x2a], [0x66, 0x4c, 0x61, 0x43], [0x49, 0x44, 0x33]]
    for (let round = 0; round < 400; round += 1) {
      const bytes = new Uint8Array(32 + (round % 2048))
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = random()
      bytes.set(prefixes[round % prefixes.length])
      const meta = await probeFileMeta(memorySource(bytes), {})
      // Whatever came out must be hashable.
      buildFileObject('r', bytes.length, 'mix256:00', meta).genObjId()
    }
  })
})

describe('buildFileObject', () => {
  it('writes the meta flat and omits undefined', () => {
    const file = buildFileObject('a.png', 3, 'mix256:00', { mime: 'image/png', width: 1, height: undefined })
    expect(file).toBeInstanceOf(FileObject)
    expect(file.toJSON()).toEqual({ name: 'a.png', size: 3, content: 'mix256:00', create_time: 0, last_update_time: 0, mime: 'image/png', width: 1 })
  })

  // The same object as `test_nested_meta_obj_id_matches_sdk` of ndn-lib.
  it('FileObject with nested meta has the ObjId Rust computes', () => {
    const file = buildFileObject('IMG.heic', 3358143, 'mix256:80c00940db74383f24e9a59c3eaf03f301a24e8c21252055cc118a662405fe3bf175d5', {
      mime: 'image/heic',
      width: 4284,
      height: 5712,
      captured_at: '2024-02-29T13:05:09.125+08:00',
      geo: { lat: 34.9949, lon: -135.7567, alt: 12.3, heading: 90.5 },
      camera: { make: 'Apple', model: 'iPhone 15', lens: 'main' },
      exposure: { iso: 400, f_number: 1.78, exposure_time: '1/120', focal_length_mm: 6.86, focal_length_35mm: 26 },
    })
    expect(file.genObjId()[0].toString()).toBe(NESTED_META_OBJ_ID)
  })
})

const NESTED_META_OBJ_ID = 'cyfile:5d0620d5989224c8cfb66f8622bfb9bbbc3003b670b0fbee4d5f1789613d1e8a'

describe('content helpers moved from Desktop', () => {
  it('strip parameters and sniff', () => {
    expect(stripMediaTypeParams(' Image/JPEG ; q=1')).toBe('image/jpeg')
    expect(stripMediaTypeParams(undefined)).toBe('')
    expect(sniffMagic(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(sniffMagic(null)).toBeNull()
    expect(heifImageSize(new Uint8Array(8))).toBeNull()
  })
})

// Real photos hold real places and times: neither they nor values derived from
// them are committed. The directory is BUCKYOS_MEDIA_SAMPLES or the sibling
// media_samples/, skipped when absent. BUCKYOS_MEDIA_META_DUMP names the private
// file written by ndn-lib `test_real_samples`, and adds the comparison with Rust.
const SAMPLES_DIR = process.env.BUCKYOS_MEDIA_SAMPLES ?? path.join(__dirname, '../../media_samples')
const describeSamples = fs.existsSync(SAMPLES_DIR) ? describe : describe.skip

describeSamples('probeFileMeta real samples', () => {
  const names = fs.existsSync(SAMPLES_DIR) ? fs.readdirSync(SAMPLES_DIR).sort() : []
  const rust = process.env.BUCKYOS_MEDIA_META_DUMP
    ? JSON.parse(fs.readFileSync(process.env.BUCKYOS_MEDIA_META_DUMP, 'utf8')) as Record<string, unknown>
    : null
  const dump: Record<string, unknown> = {}

  for (const name of names) {
    it(name, async () => {
      const bytes = new Uint8Array(fs.readFileSync(path.join(SAMPLES_DIR, name)))
      const meta = await probeFileMeta(memorySource(bytes), { name })
      expect(meta.mime?.startsWith('image/')).toBe(true)
      expect(meta.width).toBeGreaterThan(0)
      expect(meta.height).toBeGreaterThan(0)
      expect(meta.captured_at).toBeDefined()
      expect(meta.camera).toBeDefined()
      expect(meta.exposure).toBeDefined()
      if (name === 'IMG_1516.heic') expect([meta.width, meta.height]).toEqual([4284, 5712])
      buildFileObject(name, bytes.length, 'mix256:00', meta).genObjId()
      dump[name] = meta
      if (rust) expect(meta).toEqual(rust[name])
    })
  }

  // jest fails the whole file for a hook in a describe block with no tests, even a skipped one.
  if (names.length > 0) {
    afterAll(() => {
      if (process.env.BUCKYOS_MEDIA_META_TS_DUMP) fs.writeFileSync(process.env.BUCKYOS_MEDIA_META_TS_DUMP, JSON.stringify(dump))
    })
  }
})
