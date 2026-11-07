export const TEXT_CODE_EXTENSIONS = [
  'txt', 'text', 'log', 'ini', 'conf', 'cfg', 'env', 'csv', 'tsv',
  'md', 'markdown', 'rst', 'adoc',
  'json', 'jsonc', 'json5', 'xml', 'yaml', 'yml', 'toml',
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'rs', 'py', 'go', 'c', 'h', 'cc', 'cpp', 'hpp',
  'java', 'kt', 'swift', 'rb', 'php', 'sql', 'sh', 'bash', 'zsh', 'ps1', 'bat',
  'css', 'scss', 'less', 'vue', 'svelte', 'lua', 'dart', 'r', 'scala', 'ex', 'exs',
  'dockerfile', 'makefile', 'gitignore', 'editorconfig', 'lock',
]

const MEDIA_TYPE_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  apng: 'image/apng',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  psd: 'image/vnd.adobe.photoshop',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  ogv: 'video/ogg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  pdf: 'application/pdf',
  html: 'text/html',
  htm: 'text/html',
  xhtml: 'application/xhtml+xml',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  ppt: 'application/vnd.ms-powerpoint',
  odt: 'application/vnd.oasis.opendocument.text',
  zip: 'application/zip',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  '7z': 'application/x-7z-compressed',
  rar: 'application/vnd.rar',
  epub: 'application/epub+zip',
  md: 'text/markdown',
  markdown: 'text/markdown',
  json: 'application/json',
  xml: 'application/xml',
  csv: 'text/csv',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  toml: 'application/toml',
  js: 'text/javascript',
  mjs: 'text/javascript',
  cjs: 'text/javascript',
  css: 'text/css',
}

for (const ext of TEXT_CODE_EXTENSIONS) {
  if (!MEDIA_TYPE_BY_EXTENSION[ext]) MEDIA_TYPE_BY_EXTENSION[ext] = `text/x-${ext}`
}


export function extensionOf(name: string | undefined): string {
  if (!name) return ''
  const base = name.split('/').pop() ?? name
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot + 1).toLowerCase()
}

export function mediaTypeFromExtension(ext: string): string | undefined {
  return MEDIA_TYPE_BY_EXTENSION[ext.toLowerCase()]
}

export function stripMediaTypeParams(value: string | undefined | null): string {
  return (value ?? '').split(';')[0].trim().toLowerCase()
}

// ─── Bounded magic-byte probe ───

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let out = ''
  for (let i = start; i < Math.min(bytes.length, start + length); i += 1) {
    out += String.fromCharCode(bytes[i])
  }
  return out
}

function textHead(bytes: Uint8Array, length = 512): string {
  // Skip a UTF-8 BOM and leading whitespace before looking at markup.
  let start = 0
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3
  return ascii(bytes, start, length).replace(/^\s+/, '')
}

/** HEVC-coded HEIF brands (image and sequence); `mif1`/`msf1` alone is generic HEIF. */
const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs'])

function compatibleBrands(b: Uint8Array): string[] {
  const size = (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]
  const end = Math.min(b.length, size > 16 ? size : 16)
  const brands: string[] = []
  for (let at = 16; at + 4 <= end; at += 4) brands.push(ascii(b, at, 4))
  return brands
}

/** Returns the confirmed media type of a byte prefix, or null when unknown. */
export function sniffMagic(bytes: Uint8Array | null | undefined): string | null {
  if (!bytes || bytes.length < 4) return null
  const b = bytes
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (ascii(b, 0, 4) === 'GIF8') return 'image/gif'
  if (ascii(b, 0, 4) === 'RIFF' && b.length >= 12) {
    const form = ascii(b, 8, 4)
    if (form === 'WEBP') return 'image/webp'
    if (form === 'WAVE') return 'audio/wav'
    if (form === 'AVI ') return 'video/x-msvideo'
  }
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp'
  if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00) return 'image/x-icon'
  if (ascii(b, 0, 4) === 'II*\0' || ascii(b, 0, 4) === 'MM\0*') return 'image/tiff'
  if (ascii(b, 0, 4) === '8BPS') return 'image/vnd.adobe.photoshop'
  if (ascii(b, 0, 5) === '%PDF-') return 'application/pdf'
  if (b.length >= 12 && ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4)
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
    if (HEIC_BRANDS.has(brand)) return 'image/heic'
    if (brand === 'mif1' || brand === 'msf1') {
      const compatible = compatibleBrands(b)
      if (compatible.some((c) => c === 'avif' || c === 'avis')) return 'image/avif'
      return compatible.some((c) => HEIC_BRANDS.has(c)) ? 'image/heic' : 'image/heif'
    }
    if (brand === 'qt  ') return 'video/quicktime'
    if (brand === 'M4A ') return 'audio/mp4'
    return 'video/mp4'
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    return ascii(b, 0, 64).includes('webm') ? 'video/webm' : 'video/x-matroska'
  }
  if (ascii(b, 0, 4) === 'OggS') {
    const head = ascii(b, 0, 96)
    return head.includes('theora') ? 'video/ogg' : 'audio/ogg'
  }
  if (ascii(b, 0, 3) === 'ID3') return 'audio/mpeg'
  if (b[0] === 0xff && (b[1] & 0xe6) === 0xe2 && (b[1] & 0x18) !== 0x08) return 'audio/mpeg'
  if (ascii(b, 0, 4) === 'fLaC') return 'audio/flac'
  if (b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07)) {
    return 'application/zip'
  }
  if (b[0] === 0x1f && b[1] === 0x8b) return 'application/gzip'
  if (ascii(b, 0, 6) === '7z\xbc\xaf\x27\x1c') return 'application/x-7z-compressed'
  if (ascii(b, 0, 4) === 'Rar!') return 'application/vnd.rar'
  const head = textHead(b).toLowerCase()
  if (head.startsWith('<?xml') || head.startsWith('<svg') || head.startsWith('<!doctype svg')) {
    if (head.includes('<svg')) return 'image/svg+xml'
    if (head.startsWith('<?xml')) return 'application/xml'
  }
  if (head.startsWith('<!doctype html') || head.startsWith('<html') || head.startsWith('<head') || head.startsWith('<body')) {
    return 'text/html'
  }
  return null
}

// ─── HEIF primary image size (`ispe` + `irot`, no decoding) ───

export interface IsoBox {
  type: string
  start: number
  end: number
}

const MAX_ISO_BOXES = 4096

export function isoBoxes(view: DataView, start: number, end: number): IsoBox[] {
  const boxes: IsoBox[] = []
  let at = start
  while (boxes.length < MAX_ISO_BOXES && at + 8 <= end) {
    let size = view.getUint32(at)
    const type = String.fromCharCode(view.getUint8(at + 4), view.getUint8(at + 5), view.getUint8(at + 6), view.getUint8(at + 7))
    let header = 8
    if (size === 1) {
      if (at + 16 > end) break
      size = Number(view.getBigUint64(at + 8))
      if (!Number.isSafeInteger(size)) throw new RangeError('box size exceeds the safe integer range')
      header = 16
    } else if (size === 0) {
      size = end - at
    }
    if (size < header) break
    boxes.push({ type, start: at + header, end: Math.min(end, at + size) })
    at += size
  }
  return boxes
}

/**
 * Displayed size of a HEIF / HEIC primary image from the `meta` box of a
 * bounded prefix: the primary item's `ispe`, swapped for a 90°/270° `irot`.
 * Null when the prefix does not hold the box (or the file is no HEIF).
 */
export function heifImageSize(bytes: Uint8Array): { width: number; height: number } | null {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const meta = isoBoxes(view, 0, bytes.length).find((b) => b.type === 'meta')
    if (!meta) return null
    const children = isoBoxes(view, meta.start + 4, meta.end)
    const pitm = children.find((b) => b.type === 'pitm')
    const iprp = children.find((b) => b.type === 'iprp')
    if (!pitm || !iprp) return null
    const primary = view.getUint8(pitm.start) === 0 ? view.getUint16(pitm.start + 4) : view.getUint32(pitm.start + 4)
    const props = isoBoxes(view, iprp.start, iprp.end)
    const ipco = props.find((b) => b.type === 'ipco')
    if (!ipco) return null
    const properties = isoBoxes(view, ipco.start, ipco.end)
    let width = 0
    let height = 0
    let quarterTurns = 0
    for (const ipma of props.filter((b) => b.type === 'ipma')) {
      const version = view.getUint8(ipma.start)
      const wideIndex = (view.getUint8(ipma.start + 3) & 1) === 1
      let at = ipma.start + 4
      const count = view.getUint32(at)
      at += 4
      for (let i = 0; i < count && at < ipma.end; i += 1) {
        const item = version < 1 ? view.getUint16(at) : view.getUint32(at)
        at += version < 1 ? 2 : 4
        const associations = view.getUint8(at)
        at += 1
        for (let j = 0; j < associations; j += 1) {
          const index = wideIndex ? view.getUint16(at) & 0x7fff : view.getUint8(at) & 0x7f
          at += wideIndex ? 2 : 1
          if (item !== primary || index === 0) continue
          const property = properties[index - 1]
          if (property?.type === 'ispe') {
            width = view.getUint32(property.start + 4)
            height = view.getUint32(property.start + 8)
          } else if (property?.type === 'irot') {
            quarterTurns = view.getUint8(property.start) & 3
          }
        }
      }
    }
    if (!width || !height) return null
    return quarterTurns % 2 === 1 ? { width: height, height: width } : { width, height }
  } catch {
    return null
  }
}
