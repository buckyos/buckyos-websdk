// The common meta of a FileObject (`CYFS 标准对象` §10): whoever constructs a
// FileObject writes it, with this helper.
//
// Line-by-line port of cyfs-ndn/src/ndn-lib/src/media_meta.rs, the reference
// implementation. tests/media_meta_vectors.json is printed by the Rust side and
// every entry must give the same result here: a different result is a
// different ObjId. Keep the read pattern and the arithmetic identical.
//
// The parsers read only what they need, never the whole file, and stop at
// FILE_META_READ_LIMIT bytes. The input is untrusted: a parse error drops that
// group of fields and is never reported.

import {
  extensionOf,
  heifImageSize,
  isoBoxes,
  mediaTypeFromExtension,
  sniffMagic,
  stripMediaTypeParams,
} from './content_mime'
import { FileObject } from './ndn_types'
import type { FileCameraMeta, FileExposureMeta, FileGeoMeta, FileMediaMeta } from './ndn_types'

/** Upper bound of the bytes read from one file. Past it the group being parsed is dropped. */
export const FILE_META_READ_LIMIT = 8 * 1024 * 1024

const READ_WINDOW = 64 * 1024
const SNIFF_BYTES = 4096
const MAX_TEXT_BYTES = 4096
const MAX_TEXT_CHARS = 128
const MAX_JPEG_SEGMENTS = 1024
const MAX_PNG_CHUNKS = 1024
const MAX_RIFF_CHUNKS = 64
const MAX_ISO_BOXES = 4096
const MAX_ID3_FRAMES = 1024
const MP4_EPOCH_TO_UNIX_SECS = 2_082_844_800
const MAX_UNIX_SECS = 253_402_300_799
const MEDIA_ELEMENT_TIMEOUT_MS = 5000

/** Random access to the bytes of a file: exactly `length` bytes at `offset`, or an error. */
export interface FileMetaSource {
  size: number
  readAt(offset: number, length: number): Promise<Uint8Array> | Uint8Array
}

export interface ProbeFileMetaOptions {
  /** Gives the extension. Defaults to the name of a `File`. */
  name?: string
  /** What the caller knows about a file that is not media. Defaults to the type of a `Blob`. */
  declaredMime?: string
}

function isBlob(source: Blob | FileMetaSource): source is Blob {
  return typeof Blob !== 'undefined' && source instanceof Blob
}

function blobSource(blob: Blob): FileMetaSource {
  return {
    size: blob.size,
    readAt: async (offset, length) => new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer()),
  }
}

function isMediaType(mime: string): boolean {
  return mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/')
}

// `type/subtype` without parameters, or nothing for a generic or malformed value.
function declaredMediaType(declared: string | undefined): string | undefined {
  const mime = stripMediaTypeParams(declared)
  if (mime === 'application/octet-stream' || mime === 'binary/octet-stream') return undefined
  return /^[\w.+-]+\/[\w.+-]+$/.test(mime) ? mime : undefined
}

function resolveMime(magic: string | null, name: string, declared: string | undefined): string | undefined {
  if (magic && isMediaType(magic)) return magic
  return declaredMediaType(declared) ?? mediaTypeFromExtension(extensionOf(name)) ?? magic ?? undefined
}

class Reader {
  readonly size: number
  private remaining = FILE_META_READ_LIMIT
  private windowStart = 0
  private window: Uint8Array = new Uint8Array(0)

  constructor(private readonly source: FileMetaSource) {
    this.size = source.size
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    const end = offset + length
    if (!Number.isSafeInteger(end) || end > this.size) throw STOP
    if (length === 0) return new Uint8Array(0)
    const windowEnd = this.windowStart + this.window.length
    if (offset >= this.windowStart && end <= windowEnd) {
      const from = offset - this.windowStart
      return this.window.subarray(from, from + length)
    }
    const fetch = Math.min(Math.max(length, READ_WINDOW), this.size - offset)
    if (fetch > this.remaining) throw STOP
    this.remaining -= fetch
    const bytes = await this.source.readAt(offset, fetch)
    if (bytes.length !== fetch) throw STOP
    this.windowStart = offset
    this.window = bytes
    return bytes.subarray(0, length)
  }
}

const STOP = new Error('stop parsing')

// `Result::ok`: any failure of a group means the group is dropped.
async function attempt<T>(run: () => Promise<T>): Promise<T | undefined> {
  try {
    return await run()
  } catch {
    return undefined
  }
}

function attemptSync<T>(run: () => T): T | undefined {
  try {
    return run()
  } catch {
    return undefined
  }
}

function be16(b: Uint8Array, at: number): number {
  if (at + 2 > b.length) throw STOP
  return b[at] * 0x100 + b[at + 1]
}

function be32(b: Uint8Array, at: number): number {
  if (at + 4 > b.length) throw STOP
  return b[at] * 0x1000000 + b[at + 1] * 0x10000 + b[at + 2] * 0x100 + b[at + 3]
}

function be64(b: Uint8Array, at: number): number {
  const value = be32(b, at) * 0x100000000 + be32(b, at + 4)
  if (!Number.isSafeInteger(value)) throw STOP
  return value
}

function beUint(b: Uint8Array, at: number, bytes: number): number {
  switch (bytes) {
    case 0: return 0
    case 2: return be16(b, at)
    case 4: return be32(b, at)
    case 8: return be64(b, at)
    default: throw STOP
  }
}

function le16(b: Uint8Array, at: number): number {
  if (at + 2 > b.length) throw STOP
  return b[at] + b[at + 1] * 0x100
}

function le24(b: Uint8Array, at: number): number {
  if (at + 3 > b.length) throw STOP
  return b[at] + b[at + 1] * 0x100 + b[at + 2] * 0x10000
}

function le32(b: Uint8Array, at: number): number {
  if (at + 4 > b.length) throw STOP
  return b[at] + b[at + 1] * 0x100 + b[at + 2] * 0x10000 + b[at + 3] * 0x1000000
}

function asciiAt(b: Uint8Array, at: number, expected: string): boolean {
  if (at + expected.length > b.length) return false
  for (let i = 0; i < expected.length; i += 1) {
    if (b[at + i] !== expected.charCodeAt(i)) return false
  }
  return true
}

function fourCC(b: Uint8Array, at: number): string {
  return String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3])
}

/**
 * Round the absolute value, then restore the sign; `-0` becomes `0`. Plain
 * `Math.round` differs from Rust's `round` on negative `.5`, and `-0` would make
 * `genObjId` throw.
 */
function roundTo(value: number, scale: number): number | undefined {
  if (!Number.isFinite(value)) return undefined
  const rounded = Math.round(Math.abs(value) * scale) / scale
  const signed = value < 0 ? -rounded : rounded
  return signed === 0 ? 0 : signed
}

function millis(amount: number, perSecond: number): number | undefined {
  if (amount === 0 || perSecond === 0) return undefined
  const ms = Math.round((amount * 1000) / perSecond)
  return ms >= 1 && Number.isSafeInteger(ms) ? ms : undefined
}

// `char::is_whitespace` of Rust: JS `trim()` also strips U+FEFF and keeps U+0085.
const WHITESPACE = '\\u0009-\\u000d\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000'
const LEADING_WHITESPACE = new RegExp(`^[${WHITESPACE}]+`)
const TRAILING_WHITESPACE = new RegExp(`[${WHITESPACE}]+$`)

function trimEnd(text: string): string {
  return text.replace(TRAILING_WHITESPACE, '')
}

function trim(text: string): string {
  return trimEnd(text.replace(LEADING_WHITESPACE, ''))
}

function firstValue(text: string): string {
  const start = text.replace(/^\0+/, '')
  const end = start.indexOf('\0')
  return end < 0 ? start : start.slice(0, end)
}

function cleanText(text: string): string | undefined {
  const visible = firstValue(text).replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
  const out = trimEnd(Array.from(trim(visible)).slice(0, MAX_TEXT_CHARS).join(''))
  return out.length > 0 ? out : undefined
}

const utf8Decoder = new TextDecoder('utf-8', { ignoreBOM: true })

function decodeUtf8(bytes: Uint8Array): string {
  return utf8Decoder.decode(bytes)
}

function cleanBytes(bytes: Uint8Array): string | undefined {
  return cleanText(decodeUtf8(bytes))
}

function digits(text: string): number | undefined {
  return /^[0-9]+$/.test(text) ? Number(text) : undefined
}

function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 1: case 3: case 5: case 7: case 8: case 10: case 12: return 31
    case 4: case 6: case 9: case 11: return 30
    case 2: return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28
    default: return 0
  }
}

// `YYYY<sep>MM<sep>DD<t>HH:MM:SS`, as `YYYY-MM-DDTHH:MM:SS`.
function parseDateTime(text: string, dateSep: string, timeSep: string): string | undefined {
  if (text.length !== 19 || text[4] !== dateSep || text[7] !== dateSep || text[10] !== timeSep || text[13] !== ':' || text[16] !== ':') return undefined
  const year = digits(text.slice(0, 4))
  const month = digits(text.slice(5, 7))
  const day = digits(text.slice(8, 10))
  const hour = digits(text.slice(11, 13))
  const minute = digits(text.slice(14, 16))
  const second = digits(text.slice(17, 19))
  if (year === undefined || month === undefined || day === undefined || hour === undefined || minute === undefined || second === undefined) return undefined
  if (year === 0 || day === 0 || day > daysInMonth(year, month) || hour > 23 || minute > 59 || second > 59) return undefined
  return `${text.slice(0, 4)}-${text.slice(5, 7)}-${text.slice(8, 10)}T${text.slice(11, 13)}:${text.slice(14, 16)}:${text.slice(17, 19)}`
}

// `.123`, or nothing when it is not all digits. At most nanoseconds.
function parseFraction(text: string): string | undefined {
  const value = trim(text)
  return /^[0-9]+$/.test(value) ? `.${value.slice(0, 9)}` : undefined
}

// `Z`, `+HH:MM`, `+HHMM` or `+HH`, as `Z` or `+HH:MM`.
function parseOffset(text: string): string | undefined {
  const value = trim(text)
  if (value === 'Z') return 'Z'
  const match = /^([+-])([0-9]{2})(?::?([0-9]{2}))?$/.exec(value)
  if (!match) return undefined
  const hours = Number(match[2])
  const minutes = Number(match[3] ?? '00')
  if (hours > 14 || minutes > 59) return undefined
  return `${match[1]}${match[2]}:${match[3] ?? '00'}`
}

// ISO 8601 as written in `com.apple.quicktime.creationdate`.
function parseIsoDateTime(text: string): string | undefined {
  // eslint-disable-next-line no-control-regex
  if (text.length < 19 || !/^[\x00-\x7f]*$/.test(text)) return undefined
  const base = parseDateTime(text.slice(0, 19), '-', 'T')
  if (base === undefined) return undefined
  let rest = text.slice(19)
  let out = base
  if (rest.startsWith('.')) {
    const fraction = /^[0-9]*/.exec(rest.slice(1))![0]
    const parsed = parseFraction(fraction)
    if (parsed === undefined) return undefined
    out += parsed
    rest = rest.slice(1 + fraction.length)
  }
  if (rest.length > 0) {
    const offset = parseOffset(rest)
    if (offset === undefined) return undefined
    out += offset
  }
  return out
}

function utcFromMp4Time(seconds: number): string | undefined {
  if (seconds <= MP4_EPOCH_TO_UNIX_SECS) return undefined
  const unix = seconds - MP4_EPOCH_TO_UNIX_SECS
  if (unix > MAX_UNIX_SECS) return undefined
  return new Date(unix * 1000).toISOString().replace('.000Z', 'Z')
}

function gcd(a: number, b: number): number {
  while (b !== 0) {
    const next = a % b
    a = b
    b = next
  }
  return a
}

function someIfAny<T extends object>(value: T): T | undefined {
  const entries = Object.entries(value).filter(([, item]) => item !== undefined)
  return entries.length > 0 ? Object.fromEntries(entries) as T : undefined
}

// ---- EXIF: a TIFF structure, read in place ----

const TAG_MAKE = 0x010f
const TAG_MODEL = 0x0110
const TAG_ORIENTATION = 0x0112
const TAG_EXIF_IFD = 0x8769
const TAG_GPS_IFD = 0x8825
const TAG_EXPOSURE_TIME = 0x829a
const TAG_F_NUMBER = 0x829d
const TAG_ISO = 0x8827
const TAG_DATE_TIME_ORIGINAL = 0x9003
const TAG_DATE_TIME_DIGITIZED = 0x9004
const TAG_OFFSET_TIME_ORIGINAL = 0x9011
const TAG_OFFSET_TIME_DIGITIZED = 0x9012
const TAG_FOCAL_LENGTH = 0x920a
const TAG_SUB_SEC_ORIGINAL = 0x9291
const TAG_SUB_SEC_DIGITIZED = 0x9292
const TAG_FOCAL_LENGTH_35MM = 0xa405
const TAG_LENS_MODEL = 0xa434
const TAG_GPS_LAT_REF = 0x0001
const TAG_GPS_LAT = 0x0002
const TAG_GPS_LON_REF = 0x0003
const TAG_GPS_LON = 0x0004
const TAG_GPS_ALT_REF = 0x0005
const TAG_GPS_ALT = 0x0006
const TAG_GPS_IMG_DIRECTION = 0x0011
const TAG_GPS_H_ERROR = 0x001f

interface IfdEntry {
  kind: number
  count: number
  valueAt: number
}

type Ifd = Map<number, IfdEntry>

function exifTypeSize(kind: number): number | undefined {
  switch (kind) {
    case 1: case 2: case 6: case 7: case 129: return 1
    case 3: case 8: return 2
    case 4: case 9: case 11: case 13: return 4
    case 5: case 10: case 12: return 8
    default: return undefined
  }
}

class Tiff {
  constructor(
    private readonly reader: Reader,
    private readonly base: number,
    private readonly limit: number,
    private readonly littleEndian: boolean,
  ) {}

  u16At(b: Uint8Array, at: number): number {
    return this.littleEndian ? le16(b, at) : be16(b, at)
  }

  u32At(b: Uint8Array, at: number): number {
    return this.littleEndian ? le32(b, at) : be32(b, at)
  }

  async readIfd(offset: number): Promise<Ifd> {
    if (offset + 2 > this.limit) throw STOP
    const head = await this.reader.read(this.base + offset, 2)
    const count = this.u16At(head, 0)
    if (offset + 2 + count * 12 > this.limit) throw STOP
    const first = this.base + offset + 2
    const bytes = await this.reader.read(first, count * 12)
    const ifd: Ifd = new Map()
    for (let i = 0; i < count; i += 1) {
      const at = i * 12
      const tag = this.u16At(bytes, at)
      if (!ifd.has(tag)) {
        ifd.set(tag, { kind: this.u16At(bytes, at + 2), count: this.u32At(bytes, at + 4), valueAt: first + at + 8 })
      }
    }
    return ifd
  }

  private async value(entry: IfdEntry, maxBytes: number): Promise<Uint8Array> {
    const unit = exifTypeSize(entry.kind)
    if (unit === undefined) throw STOP
    const total = unit * entry.count
    const wanted = Math.min(total, maxBytes)
    if (total <= 4) return this.reader.read(entry.valueAt, wanted)
    const field = await this.reader.read(entry.valueAt, 4)
    const offset = this.u32At(field, 0)
    if (offset + total > this.limit) throw STOP
    return this.reader.read(this.base + offset, wanted)
  }

  async text(ifd: Ifd, tag: number): Promise<string | undefined> {
    const entry = ifd.get(tag)
    if (!entry || (entry.kind !== 2 && entry.kind !== 129)) return undefined
    const bytes = await attempt(() => this.value(entry, MAX_TEXT_BYTES))
    return bytes ? cleanBytes(bytes) : undefined
  }

  async uint(ifd: Ifd, tag: number): Promise<number | undefined> {
    const entry = ifd.get(tag)
    if (!entry || entry.count === 0) return undefined
    switch (entry.kind) {
      case 1: {
        const bytes = await attempt(() => this.value(entry, 1))
        return bytes?.[0]
      }
      case 3: {
        const bytes = await attempt(() => this.value(entry, 2))
        return bytes ? attemptSync(() => this.u16At(bytes, 0)) : undefined
      }
      case 4: case 13: {
        const bytes = await attempt(() => this.value(entry, 4))
        return bytes ? attemptSync(() => this.u32At(bytes, 0)) : undefined
      }
      default:
        return undefined
    }
  }

  // `count` (numerator, denominator) pairs, none with a zero denominator.
  async rationals(ifd: Ifd, tag: number, count: number): Promise<Array<[number, number]> | undefined> {
    const entry = ifd.get(tag)
    if (!entry || (entry.kind !== 5 && entry.kind !== 10) || entry.count < count) return undefined
    const bytes = await attempt(() => this.value(entry, count * 8))
    if (!bytes || bytes.length < count * 8) return undefined
    const out: Array<[number, number]> = []
    for (let i = 0; i < count; i += 1) {
      const rawNum = this.u32At(bytes, i * 8)
      const rawDen = this.u32At(bytes, i * 8 + 4)
      const num = entry.kind === 10 ? rawNum | 0 : rawNum
      const den = entry.kind === 10 ? rawDen | 0 : rawDen
      if (den === 0) return undefined
      out.push([num, den])
    }
    return out
  }

  async rational(ifd: Ifd, tag: number): Promise<number | undefined> {
    const values = await this.rationals(ifd, tag, 1)
    return values ? values[0][0] / values[0][1] : undefined
  }

  async subIfd(ifd: Ifd, tag: number): Promise<Ifd | undefined> {
    const offset = await this.uint(ifd, tag)
    if (offset === undefined) return undefined
    return attempt(() => this.readIfd(offset))
  }

  async degrees(ifd: Ifd, tag: number, refTag: number, negative: string): Promise<number | undefined> {
    const parts = await this.rationals(ifd, tag, 3)
    if (!parts) return undefined
    const reference = await this.text(ifd, refTag)
    if (reference === undefined) return undefined
    const first = /^[a-z]/.test(reference) ? reference[0].toUpperCase() : reference[0]
    const value = parts[0][0] / parts[0][1] + parts[1][0] / parts[1][1] / 60 + parts[2][0] / parts[2][1] / 3600
    if (!Number.isFinite(value) || value < 0) return undefined
    const positive = negative === 'S' ? 'N' : 'E'
    if (first === negative) return -value
    return first === positive ? value : undefined
  }
}

interface ExifFields {
  orientation?: number
  captured_at?: string
  geo?: FileGeoMeta
  camera?: FileCameraMeta
  exposure?: FileExposureMeta
}

function validGeo(lat: number, lon: number): [number, number] | undefined {
  const roundedLat = roundTo(lat, 1e6)
  const roundedLon = roundTo(lon, 1e6)
  if (roundedLat === undefined || roundedLon === undefined) return undefined
  if (roundedLat < -90 || roundedLat > 90 || roundedLon < -180 || roundedLon > 180 || (roundedLat === 0 && roundedLon === 0)) return undefined
  return [roundedLat, roundedLon]
}

async function readCapturedAt(tiff: Tiff, exif: Ifd): Promise<string | undefined> {
  const date = async (tag: number) => {
    const text = await tiff.text(exif, tag)
    return text === undefined ? undefined : parseDateTime(text, ':', ' ')
  }
  let base = await date(TAG_DATE_TIME_ORIGINAL)
  const digitized = base === undefined
  if (digitized) base = await date(TAG_DATE_TIME_DIGITIZED)
  if (base === undefined) return undefined
  let fraction = await tiff.text(exif, TAG_SUB_SEC_ORIGINAL)
  let offset = await tiff.text(exif, TAG_OFFSET_TIME_ORIGINAL)
  if (digitized) {
    if (fraction === undefined) fraction = await tiff.text(exif, TAG_SUB_SEC_DIGITIZED)
    if (offset === undefined) offset = await tiff.text(exif, TAG_OFFSET_TIME_DIGITIZED)
  }
  let out = base
  if (fraction !== undefined) out += parseFraction(fraction) ?? ''
  if (offset !== undefined) out += parseOffset(offset) ?? ''
  return out
}

async function readGeo(tiff: Tiff, gps: Ifd): Promise<FileGeoMeta | undefined> {
  const lat = await tiff.degrees(gps, TAG_GPS_LAT, TAG_GPS_LAT_REF, 'S')
  if (lat === undefined) return undefined
  const lon = await tiff.degrees(gps, TAG_GPS_LON, TAG_GPS_LON_REF, 'W')
  if (lon === undefined) return undefined
  const valid = validGeo(lat, lon)
  if (!valid) return undefined
  const geo: FileGeoMeta = { lat: valid[0], lon: valid[1] }
  const alt = await tiff.rational(gps, TAG_GPS_ALT)
  if (alt !== undefined) {
    const below = (await tiff.uint(gps, TAG_GPS_ALT_REF)) === 1
    const rounded = roundTo(below ? -Math.abs(alt) : alt, 1e1)
    if (rounded !== undefined) geo.alt = rounded
  }
  const heading = await tiff.rational(gps, TAG_GPS_IMG_DIRECTION)
  if (heading !== undefined && heading >= 0 && heading <= 360) {
    const rounded = roundTo(heading, 1e1)
    if (rounded !== undefined) geo.heading = rounded
  }
  const accuracy = await tiff.rational(gps, TAG_GPS_H_ERROR)
  if (accuracy !== undefined && accuracy >= 0) {
    const rounded = roundTo(accuracy, 1e1)
    if (rounded !== undefined) geo.accuracy_m = rounded
  }
  return geo
}

async function readExposure(tiff: Tiff, exif: Ifd): Promise<FileExposureMeta | undefined> {
  const positive = (value: number | undefined, scale: number) => (value !== undefined && value > 0 ? roundTo(value, scale) : undefined)
  const positiveUint = (value: number | undefined) => (value !== undefined && value > 0 ? value : undefined)
  const exposure: FileExposureMeta = {
    iso: positiveUint(await tiff.uint(exif, TAG_ISO)),
    f_number: positive(await tiff.rational(exif, TAG_F_NUMBER), 1e2),
    focal_length_mm: positive(await tiff.rational(exif, TAG_FOCAL_LENGTH), 1e2),
    focal_length_35mm: positiveUint(await tiff.uint(exif, TAG_FOCAL_LENGTH_35MM)),
  }
  const parts = await tiff.rationals(exif, TAG_EXPOSURE_TIME, 1)
  if (parts) {
    const [num, den] = parts[0]
    if (num > 0 && den > 0) {
      const divisor = gcd(num, den)
      const reducedDen = den / divisor
      exposure.exposure_time = reducedDen === 1 ? String(num / divisor) : `${num / divisor}/${reducedDen}`
    }
  }
  return someIfAny(exposure)
}

async function readExif(reader: Reader, base: number, limit: number): Promise<ExifFields | undefined> {
  if (limit < 8) return undefined
  const head = await attempt(() => reader.read(base, 8))
  if (!head) return undefined
  let littleEndian: boolean
  if (head[0] === 0x49 && head[1] === 0x49) littleEndian = true
  else if (head[0] === 0x4d && head[1] === 0x4d) littleEndian = false
  else return undefined
  const tiff = new Tiff(reader, base, limit, littleEndian)
  if (tiff.u16At(head, 2) !== 42) return undefined
  const first = tiff.u32At(head, 4)
  const ifd0 = await attempt(() => tiff.readIfd(first))
  if (!ifd0) return undefined
  const fields: ExifFields = { orientation: await tiff.uint(ifd0, TAG_ORIENTATION) }
  const exif = (await tiff.subIfd(ifd0, TAG_EXIF_IFD)) ?? new Map()
  fields.camera = someIfAny<FileCameraMeta>({
    make: await tiff.text(ifd0, TAG_MAKE),
    model: await tiff.text(ifd0, TAG_MODEL),
    lens: await tiff.text(exif, TAG_LENS_MODEL),
  })
  fields.captured_at = await readCapturedAt(tiff, exif)
  fields.exposure = await readExposure(tiff, exif)
  const gps = await tiff.subIfd(ifd0, TAG_GPS_IFD)
  if (gps) fields.geo = await readGeo(tiff, gps)
  return fields
}

function applyExif(meta: FileMediaMeta, fields: ExifFields): void {
  meta.captured_at = fields.captured_at
  meta.geo = fields.geo
  meta.camera = fields.camera
  meta.exposure = fields.exposure
}

function setSize(meta: FileMediaMeta, width: number, height: number): void {
  if (width > 0 && height > 0) {
    meta.width = width
    meta.height = height
  }
}

// ---- Photos ----

async function probeJpeg(reader: Reader, meta: FileMediaMeta): Promise<void> {
  let exifAt: [number, number] | undefined
  let frame: [number, number] | undefined
  let at = 2
  for (let i = 0; i < MAX_JPEG_SEGMENTS; i += 1) {
    const head = await attempt(() => reader.read(at, 2))
    if (!head || head[0] !== 0xff) break
    const marker = head[1]
    if (marker === 0xff) {
      at += 1
      continue
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      at += 2
      continue
    }
    if (marker === 0xd9 || marker === 0xda) break
    const length = await attempt(async () => be16(await reader.read(at + 2, 2), 0))
    if (length === undefined || length < 2) break
    if (marker === 0xe1 && !exifAt && length >= 8) {
      const prefix = await attempt(() => reader.read(at + 4, 6))
      if (prefix && asciiAt(prefix, 0, 'Exif\0\0')) exifAt = [at + 10, length - 8]
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const sof = await attempt(() => reader.read(at + 4, 5))
      if (sof) frame = [be16(sof, 3), be16(sof, 1)]
      break
    }
    at += 2 + length
  }
  let orientation: number | undefined
  if (exifAt) {
    const fields = await readExif(reader, exifAt[0], exifAt[1])
    if (fields) {
      orientation = fields.orientation
      applyExif(meta, fields)
    }
  }
  if (frame) {
    if (orientation !== undefined && orientation >= 5 && orientation <= 8) setSize(meta, frame[1], frame[0])
    else setSize(meta, frame[0], frame[1])
  }
}

async function probePng(reader: Reader, meta: FileMediaMeta): Promise<void> {
  const head = await attempt(() => reader.read(8, 16))
  if (head && asciiAt(head, 4, 'IHDR')) setSize(meta, be32(head, 8), be32(head, 12))
  let at = 8
  for (let i = 0; i < MAX_PNG_CHUNKS; i += 1) {
    const chunk = await attempt(() => reader.read(at, 8))
    if (!chunk) return
    const length = be32(chunk, 0)
    const kind = fourCC(chunk, 4)
    if (kind === 'IDAT' || kind === 'IEND') return
    if (kind === 'eXIf') {
      const fields = await readExif(reader, at + 8, length)
      if (fields) applyExif(meta, fields)
      return
    }
    at += 12 + length
  }
}

async function probeGif(reader: Reader, meta: FileMediaMeta): Promise<void> {
  const head = await attempt(() => reader.read(6, 4))
  if (head) setSize(meta, le16(head, 0), le16(head, 2))
}

async function probeWebp(reader: Reader, meta: FileMediaMeta): Promise<void> {
  const riff = await attempt(() => reader.read(0, 12))
  if (!riff) return
  const end = Math.min(reader.size, 8 + le32(riff, 4))
  let extended = false
  let at = 12
  for (let i = 0; i < MAX_RIFF_CHUNKS; i += 1) {
    if (at + 8 > end) return
    const head = await attempt(() => reader.read(at, 8))
    if (!head) return
    const size = le32(head, 4)
    const data = at + 8
    const kind = fourCC(head, 0)
    if (kind === 'VP8 ' && !extended) {
      const frame = await attempt(() => reader.read(data, 10))
      if (frame && frame[3] === 0x9d && frame[4] === 0x01 && frame[5] === 0x2a) {
        setSize(meta, le16(frame, 6) & 0x3fff, le16(frame, 8) & 0x3fff)
      }
      return
    }
    if (kind === 'VP8L' && !extended) {
      const frame = await attempt(() => reader.read(data, 5))
      if (frame && frame[0] === 0x2f) {
        const width = 1 + (frame[1] + (frame[2] & 0x3f) * 0x100)
        const height = 1 + ((frame[2] >> 6) + frame[3] * 4 + (frame[4] & 0x0f) * 0x400)
        setSize(meta, width, height)
      }
      return
    }
    if (kind === 'VP8X') {
      const header = await attempt(() => reader.read(data, 10))
      if (!header) return
      setSize(meta, le24(header, 4) + 1, le24(header, 7) + 1)
      if ((header[0] & 0x08) === 0) return
      extended = true
    } else if (kind === 'EXIF') {
      const prefix = await attempt(() => reader.read(data, Math.min(size, 6)))
      if (!prefix) return
      const skip = asciiAt(prefix, 0, 'Exif\0\0') ? 6 : 0
      const fields = await readExif(reader, data + skip, size - skip)
      if (fields) applyExif(meta, fields)
      return
    }
    at = data + size + (size & 1)
  }
}

async function probeTiff(reader: Reader, meta: FileMediaMeta): Promise<void> {
  const fields = await readExif(reader, 0, reader.size)
  if (fields) applyExif(meta, fields)
}

// ---- ISO BMFF: HEIF, MP4, MOV, m4a ----

interface FileIsoBox {
  kind: string
  at: number
  start: number
  end: number
  next: number
}

async function readIsoBox(reader: Reader, at: number, end: number): Promise<FileIsoBox | undefined> {
  if (at + 8 > end) return undefined
  const head = await reader.read(at, 8)
  let size = be32(head, 0)
  const kind = fourCC(head, 4)
  let header = 8
  if (size === 1) {
    if (at + 16 > end) return undefined
    size = be64(await reader.read(at + 8, 8), 0)
    header = 16
  } else if (size === 0) {
    size = end - at
  }
  if (size < header) return undefined
  return { kind, at, start: at + header, end: Math.min(end, at + size), next: at + size }
}

// Boxes of `[start, end)` without reading their payload, so a large `stbl`
// table costs nothing.
async function readChildren(reader: Reader, start: number, end: number): Promise<FileIsoBox[]> {
  const boxes: FileIsoBox[] = []
  let at = start
  while (boxes.length < MAX_ISO_BOXES) {
    const found = await readIsoBox(reader, at, end)
    if (!found) break
    at = found.next
    boxes.push(found)
  }
  return boxes
}

function heifExifExtent(b: Uint8Array): [number, number] | undefined {
  return attemptSync(() => {
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
    const meta = isoBoxes(view, 0, b.length).find(box => box.type === 'meta')
    if (!meta) return undefined
    const children = isoBoxes(view, meta.start + 4, meta.end)
    const iinf = children.find(box => box.type === 'iinf')
    const iloc = children.find(box => box.type === 'iloc')
    if (!iinf || !iloc) return undefined

    // The item id of the first `Exif` item in `iinf`.
    if (iinf.start >= b.length) throw STOP
    const first = iinf.start + (b[iinf.start] === 0 ? 6 : 8)
    let wanted: number | undefined
    for (const infe of isoBoxes(view, first, iinf.end)) {
      if (infe.type !== 'infe') continue
      if (infe.start >= b.length) throw STOP
      const version = b[infe.start]
      let item: number
      let kindAt: number
      if (version === 2) {
        item = be16(b, infe.start + 4)
        kindAt = infe.start + 8
      } else if (version === 3) {
        item = be32(b, infe.start + 4)
        kindAt = infe.start + 10
      } else {
        continue
      }
      if (asciiAt(b, kindAt, 'Exif')) {
        wanted = item
        break
      }
    }
    if (wanted === undefined) return undefined

    // File offset and length of a single-extent item stored in the file.
    let at = iloc.start
    if (at + 6 > b.length) throw STOP
    const version = b[at]
    if (version > 2) return undefined
    const offsetSize = b[at + 4] >> 4
    const lengthSize = b[at + 4] & 0x0f
    const baseSize = b[at + 5] >> 4
    const indexSize = version >= 1 ? b[at + 5] & 0x0f : 0
    at += 6
    const count = version < 2 ? be16(b, at) : be32(b, at)
    at += version < 2 ? 2 : 4
    for (let i = 0; i < count; i += 1) {
      const item = version < 2 ? be16(b, at) : be32(b, at)
      at += version < 2 ? 2 : 4
      let method = 0
      if (version >= 1) {
        method = be16(b, at) & 0x0f
        at += 2
      }
      at += 2
      const base = beUint(b, at, baseSize)
      at += baseSize
      const extents = be16(b, at)
      at += 2
      let extent: [number, number] | undefined
      for (let j = 0; j < extents; j += 1) {
        at += indexSize
        const offset = beUint(b, at, offsetSize)
        at += offsetSize
        const length = beUint(b, at, lengthSize)
        at += lengthSize
        extent = [base + offset, length]
      }
      if (item === wanted) return method === 0 && extents === 1 ? extent : undefined
    }
    return undefined
  })
}

async function findTopLevelBox(reader: Reader, kind: string): Promise<FileIsoBox | undefined> {
  let at = 0
  for (let i = 0; i < MAX_ISO_BOXES; i += 1) {
    const found = await readIsoBox(reader, at, reader.size)
    if (!found) break
    if (found.kind === kind) return found
    at = found.next
  }
  return undefined
}

async function probeHeif(reader: Reader, meta: FileMediaMeta): Promise<void> {
  const metaBox = await attempt(() => findTopLevelBox(reader, 'meta'))
  if (!metaBox) return
  const bytes = await attempt(() => reader.read(metaBox.at, metaBox.end - metaBox.at))
  if (!bytes) return
  const size = heifImageSize(bytes)
  if (size) setSize(meta, size.width, size.height)
  const extent = heifExifExtent(bytes)
  if (!extent) return
  const [offset, length] = extent
  if (length < 4) return
  const prefix = await attempt(() => reader.read(offset, 4))
  if (!prefix) return
  const tiffOffset = be32(prefix, 0)
  if (tiffOffset + 4 > length) return
  const fields = await readExif(reader, offset + 4 + tiffOffset, length - 4 - tiffOffset)
  if (fields) applyExif(meta, fields)
}

interface IsoMedia {
  hasVideo: boolean
  hasAudio: boolean
  width: number
  height: number
  videoCodec?: string
  audioCodec?: string
  durationMs?: number
  mvhdTime?: string
  creationDate?: string
  location?: FileGeoMeta
  accuracy?: number
  make?: string
  model?: string
  title?: string
  artist?: string
  album?: string
}

function codecName(format: string): string | undefined {
  switch (format) {
    case 'avc1': case 'avc3': return 'h264'
    case 'hvc1': case 'hev1': return 'hevc'
    case 'av01': return 'av1'
    case 'vp09': return 'vp9'
    case 'mp4a': return 'aac'
    default: return undefined
  }
}

// `+34.9949-135.7567+012.300/`. Only decimal degrees; other ISO 6709 forms fall
// out of the coordinate range and are dropped.
function parseIso6709(text: string): FileGeoMeta | undefined {
  const body = text.endsWith('/') ? text.slice(0, -1) : text
  const parts: number[] = []
  let start = -1
  for (let index = 0; index < body.length; index += 1) {
    const c = body[index]
    if (c === '+' || c === '-') {
      if (start >= 0) {
        const value = parseCoordinate(body.slice(start, index))
        if (value === undefined) return undefined
        parts.push(value)
      }
      start = index
    } else if (start < 0 || !/[0-9.]/.test(c)) {
      return undefined
    }
  }
  if (start < 0) return undefined
  const last = parseCoordinate(body.slice(start))
  if (last === undefined) return undefined
  parts.push(last)
  if (parts.length < 2 || parts.length > 3) return undefined
  const valid = validGeo(parts[0], parts[1])
  if (!valid) return undefined
  const geo: FileGeoMeta = { lat: valid[0], lon: valid[1] }
  if (parts.length === 3) {
    const alt = roundTo(parts[2], 1e1)
    if (alt !== undefined) geo.alt = alt
  }
  return geo
}

function parseCoordinate(text: string): number | undefined {
  return /^[+-][0-9]+(\.[0-9]+)?$/.test(text) ? Number(text) : undefined
}

function parseDecimal(text: string): number | undefined {
  return /^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$/.test(text) ? Number(text) : undefined
}

function applyItem(media: IsoMedia, key: string, text: string): void {
  const clean = cleanText(text)
  switch (key) {
    case 'com.apple.quicktime.creationdate':
      if (media.creationDate === undefined && clean !== undefined) media.creationDate = parseIsoDateTime(clean)
      break
    case 'com.apple.quicktime.location.ISO6709':
      if (media.location === undefined && clean !== undefined) media.location = parseIso6709(clean)
      break
    case 'com.apple.quicktime.location.accuracy.horizontal': {
      const value = clean === undefined ? undefined : parseDecimal(clean)
      media.accuracy = value !== undefined && Number.isFinite(value) && value >= 0 ? roundTo(value, 1e1) : undefined
      break
    }
    case 'com.apple.quicktime.make':
      media.make = clean
      break
    case 'com.apple.quicktime.model':
      media.model = clean
      break
  }
}

async function readItemText(reader: Reader, item: FileIsoBox): Promise<string | undefined> {
  for (const child of await readChildren(reader, item.start, item.end)) {
    if (child.kind !== 'data' || child.end < child.start + 8) continue
    const head = await reader.read(child.start, 4)
    if (be32(head, 0) % 0x1000000 !== 1) return undefined
    const length = Math.min(child.end - child.start - 8, MAX_TEXT_BYTES)
    return decodeUtf8(await reader.read(child.start + 8, length))
  }
  return undefined
}

// `meta`: a FullBox in ISO files, a plain box in QuickTime. Holds `ilst`, keyed
// by `keys` in QuickTime and by four-character codes in iTunes.
async function readMetaBox(reader: Reader, meta: FileIsoBox, media: IsoMedia): Promise<void> {
  if (meta.end < meta.start + 8) return
  const probe = await reader.read(meta.start + 4, 4)
  const first = asciiAt(probe, 0, 'hdlr') ? meta.start : meta.start + 4
  const children = await readChildren(reader, first, meta.end)
  const keys: string[] = []
  const keysBox = children.find(box => box.kind === 'keys')
  if (keysBox) {
    const head = await reader.read(keysBox.start, 8)
    const count = be32(head, 4)
    let at = keysBox.start + 8
    for (let i = 0; i < Math.min(count, MAX_ISO_BOXES); i += 1) {
      const entry = await readIsoBox(reader, at, keysBox.end)
      if (!entry) break
      const length = Math.min(entry.end - entry.start, MAX_TEXT_BYTES)
      keys.push(decodeUtf8(await reader.read(entry.start, length)))
      at = entry.next
    }
  }
  const ilst = children.find(box => box.kind === 'ilst')
  if (!ilst) return
  for (const item of await readChildren(reader, ilst.start, ilst.end)) {
    const index = item.kind.charCodeAt(0) * 0x1000000 + item.kind.charCodeAt(1) * 0x10000 + item.kind.charCodeAt(2) * 0x100 + item.kind.charCodeAt(3)
    if (index >= 1 && index <= keys.length) {
      const text = await readItemText(reader, item)
      if (text !== undefined) applyItem(media, keys[index - 1], text)
      continue
    }
    if (item.kind !== '\xa9nam' && item.kind !== '\xa9ART' && item.kind !== '\xa9alb') continue
    const text = await readItemText(reader, item)
    if (text === undefined) continue
    const value = cleanText(text)
    if (item.kind === '\xa9nam') media.title = value
    else if (item.kind === '\xa9ART') media.artist = value
    else media.album = value
  }
}

async function readUdta(reader: Reader, udta: FileIsoBox, media: IsoMedia): Promise<void> {
  for (const child of await readChildren(reader, udta.start, udta.end)) {
    if (child.kind === '\xa9xyz' && child.end >= child.start + 4) {
      const head = await reader.read(child.start, 2)
      const length = Math.min(be16(head, 0), child.end - child.start - 4, MAX_TEXT_BYTES)
      const bytes = await reader.read(child.start + 4, length)
      if (media.location === undefined) {
        const text = cleanBytes(bytes)
        media.location = text === undefined ? undefined : parseIso6709(text)
      }
    } else if (child.kind === 'meta') {
      await readMetaBox(reader, child, media)
    }
  }
}

async function readMvhd(reader: Reader, mvhd: FileIsoBox, media: IsoMedia): Promise<void> {
  const bytes = await reader.read(mvhd.start, Math.min(mvhd.end - mvhd.start, 32))
  if (bytes.length === 0) throw STOP
  const version = bytes[0]
  const created = attemptSync(() => (version === 1 ? be64(bytes, 4) : be32(bytes, 4)))
  const timescale = version === 1 ? be32(bytes, 20) : be32(bytes, 12)
  const duration = attemptSync(() => (version === 1 ? be64(bytes, 24) : be32(bytes, 16)))
  media.mvhdTime = created === undefined ? undefined : utcFromMp4Time(created)
  media.durationMs = duration === undefined || (version !== 1 && duration === 0xffffffff) ? undefined : millis(duration, timescale)
}

async function readTrak(reader: Reader, trak: FileIsoBox, media: IsoMedia): Promise<void> {
  const children = await readChildren(reader, trak.start, trak.end)
  const mdia = children.find(box => box.kind === 'mdia')
  if (!mdia) return
  const mdiaChildren = await readChildren(reader, mdia.start, mdia.end)
  const hdlr = mdiaChildren.find(box => box.kind === 'hdlr')
  if (!hdlr) return
  const handler = fourCC(await reader.read(hdlr.start + 8, 4), 0)
  const isVideo = handler === 'vide'
  const isAudio = handler === 'soun'
  if (!isVideo && !isAudio) return
  if (isAudio) media.hasAudio = true
  else media.hasVideo = true
  let format: string | undefined
  const minf = mdiaChildren.find(box => box.kind === 'minf')
  if (minf) {
    const minfChildren = await readChildren(reader, minf.start, minf.end)
    const stbl = minfChildren.find(box => box.kind === 'stbl')
    if (stbl) {
      const stblChildren = await readChildren(reader, stbl.start, stbl.end)
      const stsd = stblChildren.find(box => box.kind === 'stsd')
      if (stsd && stsd.end >= stsd.start + 16) format = fourCC(await reader.read(stsd.start + 12, 4), 0)
    }
  }
  const codec = format === undefined ? undefined : codecName(format)
  if (isAudio) {
    if (media.audioCodec === undefined) media.audioCodec = codec
    return
  }
  if (media.width > 0) return
  const tkhd = children.find(box => box.kind === 'tkhd')
  if (!tkhd) return
  const bytes = await reader.read(tkhd.start, Math.min(tkhd.end - tkhd.start, 96))
  if (bytes.length === 0) throw STOP
  const matrix = bytes[0] === 1 ? 52 : 40
  const fixed = (at: number) => Math.floor((be32(bytes, at) + 0x8000) / 0x10000)
  const width = fixed(matrix + 36)
  const height = fixed(matrix + 40)
  if (width === 0 || height === 0) return
  const a = be32(bytes, matrix)
  const b = be32(bytes, matrix + 4)
  const c = be32(bytes, matrix + 12)
  const d = be32(bytes, matrix + 16)
  const quarterTurn = a === 0 && d === 0 && b !== 0 && c !== 0
  media.width = quarterTurn ? height : width
  media.height = quarterTurn ? width : height
  media.videoCodec = codec
}

async function readMoov(reader: Reader, media: IsoMedia): Promise<void> {
  const moov = await findTopLevelBox(reader, 'moov')
  if (!moov) return
  for (const child of await readChildren(reader, moov.start, moov.end)) {
    switch (child.kind) {
      case 'mvhd': await readMvhd(reader, child, media); break
      case 'trak': await readTrak(reader, child, media); break
      case 'udta': await readUdta(reader, child, media); break
      case 'meta': await readMetaBox(reader, child, media); break
    }
  }
}

async function probeIsoMedia(reader: Reader, meta: FileMediaMeta): Promise<void> {
  const media: IsoMedia = { hasVideo: false, hasAudio: false, width: 0, height: 0 }
  await attempt(() => readMoov(reader, media))
  if (meta.mime === 'video/mp4' && !media.hasVideo && media.hasAudio) meta.mime = 'audio/mp4'
  meta.duration_ms = media.durationMs
  meta.audio_codec = media.audioCodec
  if (meta.mime?.startsWith('audio/')) {
    meta.title = media.title
    meta.artist = media.artist
    meta.album = media.album
    return
  }
  setSize(meta, media.width, media.height)
  meta.video_codec = media.videoCodec
  meta.captured_at = media.creationDate ?? media.mvhdTime
  meta.geo = media.location && someIfAny<FileGeoMeta>({ ...media.location, accuracy_m: media.accuracy })
  meta.camera = someIfAny<FileCameraMeta>({ make: media.make, model: media.model })
}

// ---- Audio ----

async function probeFlac(reader: Reader, meta: FileMediaMeta): Promise<void> {
  const head = await attempt(() => reader.read(4, 22))
  if (!head || (head[0] & 0x7f) !== 0) return
  const info = head.subarray(4)
  const rate = info[10] * 0x1000 + info[11] * 0x10 + (info[12] >> 4)
  const samples = (info[13] & 0x0f) * 0x100000000 + be32(info, 14)
  meta.duration_ms = millis(samples, rate)
}

async function probeWav(reader: Reader, meta: FileMediaMeta): Promise<void> {
  const riff = await attempt(() => reader.read(0, 12))
  if (!riff) return
  const end = Math.min(reader.size, 8 + le32(riff, 4))
  let byteRate: number | undefined
  let dataSize: number | undefined
  let at = 12
  for (let i = 0; i < MAX_RIFF_CHUNKS; i += 1) {
    if (at + 8 > end) break
    const head = await attempt(() => reader.read(at, 8))
    if (!head) break
    const size = le32(head, 4)
    const data = at + 8
    const kind = fourCC(head, 0)
    if (kind === 'fmt ') {
      const format = await attempt(() => reader.read(data, 12))
      if (!format) break
      byteRate = le32(format, 8)
    } else if (kind === 'data') {
      dataSize = Math.min(size, reader.size - data)
    }
    if (byteRate !== undefined && dataSize !== undefined) break
    at = data + size + (size & 1)
  }
  if (byteRate !== undefined && dataSize !== undefined) meta.duration_ms = millis(dataSize, byteRate)
}

function syncsafe(b: Uint8Array, at: number): number {
  if (at + 4 > b.length) throw STOP
  if ((b[at] | b[at + 1] | b[at + 2] | b[at + 3]) & 0x80) throw STOP
  return b[at] * 0x200000 + b[at + 1] * 0x4000 + b[at + 2] * 0x80 + b[at + 3]
}

// `String::from_utf16_lossy`: an unpaired surrogate becomes U+FFFD, so the text
// can never carry one into `genObjId`.
function decodeUtf16(bytes: Uint8Array, bigEndian: boolean): string {
  const units: number[] = []
  for (let at = 0; at + 2 <= bytes.length; at += 2) {
    units.push(bigEndian ? be16(bytes, at) : le16(bytes, at))
  }
  let out = ''
  for (let i = 0; i < units.length; i += 1) {
    const unit = units[i]
    if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < units.length && units[i + 1] >= 0xdc00 && units[i + 1] <= 0xdfff) {
      out += String.fromCharCode(unit, units[i + 1])
      i += 1
    } else if (unit >= 0xd800 && unit <= 0xdfff) {
      out += '�'
    } else {
      out += String.fromCharCode(unit)
    }
  }
  return out
}

function decodeId3Text(b: Uint8Array): string | undefined {
  if (b.length === 0) return undefined
  const encoding = b[0]
  const payload = b.subarray(1)
  let text: string
  switch (encoding) {
    case 0:
      text = Array.from(payload, c => String.fromCharCode(c)).join('')
      break
    case 1:
      if (payload[0] === 0xfe && payload[1] === 0xff) text = decodeUtf16(payload.subarray(2), true)
      else if (payload[0] === 0xff && payload[1] === 0xfe) text = decodeUtf16(payload.subarray(2), false)
      else text = decodeUtf16(payload, false)
      break
    case 2:
      text = decodeUtf16(payload, true)
      break
    case 3:
      text = decodeUtf8(payload)
      break
    default:
      return undefined
  }
  return cleanText(text)
}

async function readId3(reader: Reader, meta: FileMediaMeta): Promise<void> {
  const header = await reader.read(0, 10)
  const version = header[3]
  if (!asciiAt(header, 0, 'ID3') || version < 2 || version > 4 || (header[5] & 0x80) !== 0) return
  const end = Math.min(10 + syncsafe(header, 6), reader.size)
  let at = 10
  if ((header[5] & 0x40) !== 0) {
    if (version === 3) at += 4 + be32(await reader.read(at, 4), 0)
    else if (version === 4) at += syncsafe(await reader.read(at, 4), 0)
    else return
  }
  const headerSize = version === 2 ? 6 : 10
  for (let i = 0; i < MAX_ID3_FRAMES; i += 1) {
    if (at + headerSize > end) break
    const frame = await reader.read(at, headerSize)
    if (frame[0] === 0) break
    let id: string
    let size: number
    let skip: boolean
    if (version === 2) {
      id = String.fromCharCode(frame[0], frame[1], frame[2])
      size = frame[3] * 0x10000 + frame[4] * 0x100 + frame[5]
      skip = false
    } else if (version === 3) {
      id = fourCC(frame, 0)
      size = be32(frame, 4)
      skip = (frame[9] & 0xe0) !== 0
    } else {
      id = fourCC(frame, 0)
      size = syncsafe(frame, 4)
      skip = (frame[9] & 0x4f) !== 0
    }
    const key = id === 'TIT2' || id === 'TT2' ? 'title' : id === 'TPE1' || id === 'TP1' ? 'artist' : id === 'TALB' || id === 'TAL' ? 'album' : undefined
    if (key && !skip && size > 0) {
      const length = Math.min(size, MAX_TEXT_BYTES, end - (at + headerSize))
      const bytes = await reader.read(at + headerSize, length)
      if (meta[key] === undefined) meta[key] = decodeId3Text(bytes)
      if (meta.title !== undefined && meta.artist !== undefined && meta.album !== undefined) break
    }
    at += headerSize + size
  }
}

function withoutUndefined(meta: FileMediaMeta): FileMediaMeta {
  return Object.fromEntries(Object.entries(meta).filter(([, value]) => value !== undefined)) as FileMediaMeta
}

// ---- Media elements: only for what the bytes cannot tell ----

function loadMedia<T>(blob: Blob, tag: 'img' | 'video' | 'audio', read: (element: HTMLImageElement | HTMLMediaElement) => T): Promise<T | undefined> {
  const url = URL.createObjectURL(blob)
  return new Promise<T | undefined>(resolve => {
    const element = document.createElement(tag)
    const done = (value: T | undefined) => {
      clearTimeout(timer)
      URL.revokeObjectURL(url)
      resolve(value)
    }
    const timer = setTimeout(() => done(undefined), MEDIA_ELEMENT_TIMEOUT_MS)
    element.addEventListener(tag === 'img' ? 'load' : 'loadedmetadata', () => done(read(element)))
    element.addEventListener('error', () => done(undefined))
    if (element instanceof HTMLMediaElement) element.preload = 'metadata'
    element.src = url
  })
}

function durationOf(element: HTMLMediaElement): number | undefined {
  const ms = Math.round(element.duration * 1000)
  return Number.isSafeInteger(ms) && ms >= 1 ? ms : undefined
}

async function fillFromMediaElement(blob: Blob, meta: FileMediaMeta): Promise<void> {
  if (typeof document === 'undefined' || !meta.mime || typeof URL === 'undefined' || !URL.createObjectURL) return
  if (meta.mime.startsWith('image/') && meta.width === undefined) {
    const size = await loadMedia(blob, 'img', element => {
      const image = element as HTMLImageElement
      return { width: image.naturalWidth, height: image.naturalHeight }
    })
    if (size) setSize(meta, size.width, size.height)
  } else if (meta.mime.startsWith('video/') && (meta.width === undefined || meta.duration_ms === undefined)) {
    const info = await loadMedia(blob, 'video', element => {
      const video = element as HTMLVideoElement
      return { width: video.videoWidth, height: video.videoHeight, duration: durationOf(video) }
    })
    if (info) {
      if (meta.width === undefined) setSize(meta, info.width, info.height)
      if (meta.duration_ms === undefined) meta.duration_ms = info.duration
    }
  } else if (meta.mime.startsWith('audio/') && meta.duration_ms === undefined) {
    meta.duration_ms = await loadMedia(blob, 'audio', element => durationOf(element as HTMLMediaElement))
  }
}

/**
 * The common meta of a file: `mime`, display size, duration, codecs, audio tags,
 * capture time, location, camera and exposure, parsed from the bytes without
 * decoding. Never fails: a field that cannot be determined is omitted. Only a
 * size or duration the bytes cannot tell (WebM, MP3) comes from a media element,
 * and only for a `Blob` where there is a DOM.
 */
export async function probeFileMeta(source: Blob | FileMetaSource, options: ProbeFileMetaOptions = {}): Promise<FileMediaMeta> {
  const blob = isBlob(source) ? source : undefined
  const name = options.name ?? (blob && 'name' in blob ? String((blob as File).name) : '')
  const declaredMime = options.declaredMime ?? blob?.type
  const reader = new Reader(blob ? blobSource(blob) : source as FileMetaSource)
  const head = await attempt(() => reader.read(0, Math.min(reader.size, SNIFF_BYTES)))
  const meta: FileMediaMeta = { mime: resolveMime(sniffMagic(head), name, declaredMime) }
  await attempt(async () => {
    switch (meta.mime) {
      case 'image/jpeg': await probeJpeg(reader, meta); break
      case 'image/png': await probePng(reader, meta); break
      case 'image/gif': await probeGif(reader, meta); break
      case 'image/webp': await probeWebp(reader, meta); break
      case 'image/heic': case 'image/heif': case 'image/avif': await probeHeif(reader, meta); break
      case 'image/tiff': await probeTiff(reader, meta); break
      case 'video/mp4': case 'video/quicktime': case 'audio/mp4': await probeIsoMedia(reader, meta); break
      case 'audio/flac': await probeFlac(reader, meta); break
      case 'audio/wav': await probeWav(reader, meta); break
      case 'audio/mpeg': await readId3(reader, meta); break
    }
  })
  if (blob) await attempt(() => fillFromMediaElement(blob, meta))
  return withoutUndefined(meta)
}

/** A `cyfile` with the common meta written, ready for `genObjId`. */
export function buildFileObject(name: string, size: number, content: string, meta: FileMediaMeta = {}): FileObject {
  const file = new FileObject(name, size, content)
  file.meta = withoutUndefined(meta) as Record<string, unknown>
  return file
}
