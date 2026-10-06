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
