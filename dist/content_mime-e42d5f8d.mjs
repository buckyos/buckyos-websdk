const TEXT_CODE_EXTENSIONS = [
  "txt",
  "text",
  "log",
  "ini",
  "conf",
  "cfg",
  "env",
  "csv",
  "tsv",
  "md",
  "markdown",
  "rst",
  "adoc",
  "json",
  "jsonc",
  "json5",
  "xml",
  "yaml",
  "yml",
  "toml",
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "rs",
  "py",
  "go",
  "c",
  "h",
  "cc",
  "cpp",
  "hpp",
  "java",
  "kt",
  "swift",
  "rb",
  "php",
  "sql",
  "sh",
  "bash",
  "zsh",
  "ps1",
  "bat",
  "css",
  "scss",
  "less",
  "vue",
  "svelte",
  "lua",
  "dart",
  "r",
  "scala",
  "ex",
  "exs",
  "dockerfile",
  "makefile",
  "gitignore",
  "editorconfig",
  "lock"
];
const MEDIA_TYPE_BY_EXTENSION = {
  png: "image/png",
  apng: "image/apng",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
  tif: "image/tiff",
  tiff: "image/tiff",
  psd: "image/vnd.adobe.photoshop",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  ogv: "video/ogg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  flac: "audio/flac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  pdf: "application/pdf",
  html: "text/html",
  htm: "text/html",
  xhtml: "application/xhtml+xml",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  doc: "application/msword",
  xls: "application/vnd.ms-excel",
  ppt: "application/vnd.ms-powerpoint",
  odt: "application/vnd.oasis.opendocument.text",
  zip: "application/zip",
  tar: "application/x-tar",
  gz: "application/gzip",
  "7z": "application/x-7z-compressed",
  rar: "application/vnd.rar",
  epub: "application/epub+zip",
  md: "text/markdown",
  markdown: "text/markdown",
  json: "application/json",
  xml: "application/xml",
  csv: "text/csv",
  yaml: "application/yaml",
  yml: "application/yaml",
  toml: "application/toml",
  js: "text/javascript",
  mjs: "text/javascript",
  cjs: "text/javascript",
  css: "text/css"
};
for (const ext of TEXT_CODE_EXTENSIONS) {
  if (!MEDIA_TYPE_BY_EXTENSION[ext])
    MEDIA_TYPE_BY_EXTENSION[ext] = `text/x-${ext}`;
}
function extensionOf(name) {
  if (!name)
    return "";
  const base = name.split("/").pop() ?? name;
  const dot = base.lastIndexOf(".");
  if (dot <= 0)
    return "";
  return base.slice(dot + 1).toLowerCase();
}
function mediaTypeFromExtension(ext) {
  return MEDIA_TYPE_BY_EXTENSION[ext.toLowerCase()];
}
function stripMediaTypeParams(value) {
  return (value ?? "").split(";")[0].trim().toLowerCase();
}
function ascii(bytes, start, length) {
  let out = "";
  for (let i = start; i < Math.min(bytes.length, start + length); i += 1) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}
function textHead(bytes, length = 512) {
  let start = 0;
  if (bytes.length >= 3 && bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191)
    start = 3;
  return ascii(bytes, start, length).replace(/^\s+/, "");
}
const HEIC_BRANDS = /* @__PURE__ */ new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs"]);
function compatibleBrands(b) {
  const size = b[0] << 24 | b[1] << 16 | b[2] << 8 | b[3];
  const end = Math.min(b.length, size > 16 ? size : 16);
  const brands = [];
  for (let at = 16; at + 4 <= end; at += 4)
    brands.push(ascii(b, at, 4));
  return brands;
}
function sniffMagic(bytes) {
  if (!bytes || bytes.length < 4)
    return null;
  const b = bytes;
  if (b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71)
    return "image/png";
  if (b[0] === 255 && b[1] === 216 && b[2] === 255)
    return "image/jpeg";
  if (ascii(b, 0, 4) === "GIF8")
    return "image/gif";
  if (ascii(b, 0, 4) === "RIFF" && b.length >= 12) {
    const form = ascii(b, 8, 4);
    if (form === "WEBP")
      return "image/webp";
    if (form === "WAVE")
      return "audio/wav";
    if (form === "AVI ")
      return "video/x-msvideo";
  }
  if (b[0] === 66 && b[1] === 77)
    return "image/bmp";
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0)
    return "image/x-icon";
  if (ascii(b, 0, 4) === "II*\0" || ascii(b, 0, 4) === "MM\0*")
    return "image/tiff";
  if (ascii(b, 0, 4) === "8BPS")
    return "image/vnd.adobe.photoshop";
  if (ascii(b, 0, 5) === "%PDF-")
    return "application/pdf";
  if (b.length >= 12 && ascii(b, 4, 4) === "ftyp") {
    const brand = ascii(b, 8, 4);
    if (brand === "avif" || brand === "avis")
      return "image/avif";
    if (HEIC_BRANDS.has(brand))
      return "image/heic";
    if (brand === "mif1" || brand === "msf1") {
      const compatible = compatibleBrands(b);
      if (compatible.some((c) => c === "avif" || c === "avis"))
        return "image/avif";
      return compatible.some((c) => HEIC_BRANDS.has(c)) ? "image/heic" : "image/heif";
    }
    if (brand === "qt  ")
      return "video/quicktime";
    if (brand === "M4A ")
      return "audio/mp4";
    return "video/mp4";
  }
  if (b[0] === 26 && b[1] === 69 && b[2] === 223 && b[3] === 163) {
    return ascii(b, 0, 64).includes("webm") ? "video/webm" : "video/x-matroska";
  }
  if (ascii(b, 0, 4) === "OggS") {
    const head2 = ascii(b, 0, 96);
    return head2.includes("theora") ? "video/ogg" : "audio/ogg";
  }
  if (ascii(b, 0, 3) === "ID3")
    return "audio/mpeg";
  if (b[0] === 255 && (b[1] & 230) === 226 && (b[1] & 24) !== 8)
    return "audio/mpeg";
  if (ascii(b, 0, 4) === "fLaC")
    return "audio/flac";
  if (b[0] === 80 && b[1] === 75 && (b[2] === 3 || b[2] === 5 || b[2] === 7)) {
    return "application/zip";
  }
  if (b[0] === 31 && b[1] === 139)
    return "application/gzip";
  if (ascii(b, 0, 6) === "7z¼¯'")
    return "application/x-7z-compressed";
  if (ascii(b, 0, 4) === "Rar!")
    return "application/vnd.rar";
  const head = textHead(b).toLowerCase();
  if (head.startsWith("<?xml") || head.startsWith("<svg") || head.startsWith("<!doctype svg")) {
    if (head.includes("<svg"))
      return "image/svg+xml";
    if (head.startsWith("<?xml"))
      return "application/xml";
  }
  if (head.startsWith("<!doctype html") || head.startsWith("<html") || head.startsWith("<head") || head.startsWith("<body")) {
    return "text/html";
  }
  return null;
}
const MAX_ISO_BOXES = 4096;
function isoBoxes(view, start, end) {
  const boxes = [];
  let at = start;
  while (boxes.length < MAX_ISO_BOXES && at + 8 <= end) {
    let size = view.getUint32(at);
    const type = String.fromCharCode(view.getUint8(at + 4), view.getUint8(at + 5), view.getUint8(at + 6), view.getUint8(at + 7));
    let header = 8;
    if (size === 1) {
      if (at + 16 > end)
        break;
      size = Number(view.getBigUint64(at + 8));
      if (!Number.isSafeInteger(size))
        throw new RangeError("box size exceeds the safe integer range");
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header)
      break;
    boxes.push({ type, start: at + header, end: Math.min(end, at + size) });
    at += size;
  }
  return boxes;
}
function heifImageSize(bytes) {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const meta = isoBoxes(view, 0, bytes.length).find((b) => b.type === "meta");
    if (!meta)
      return null;
    const children = isoBoxes(view, meta.start + 4, meta.end);
    const pitm = children.find((b) => b.type === "pitm");
    const iprp = children.find((b) => b.type === "iprp");
    if (!pitm || !iprp)
      return null;
    const primary = view.getUint8(pitm.start) === 0 ? view.getUint16(pitm.start + 4) : view.getUint32(pitm.start + 4);
    const props = isoBoxes(view, iprp.start, iprp.end);
    const ipco = props.find((b) => b.type === "ipco");
    if (!ipco)
      return null;
    const properties = isoBoxes(view, ipco.start, ipco.end);
    let width = 0;
    let height = 0;
    let quarterTurns = 0;
    for (const ipma of props.filter((b) => b.type === "ipma")) {
      const version = view.getUint8(ipma.start);
      const wideIndex = (view.getUint8(ipma.start + 3) & 1) === 1;
      let at = ipma.start + 4;
      const count = view.getUint32(at);
      at += 4;
      for (let i = 0; i < count && at < ipma.end; i += 1) {
        const item = version < 1 ? view.getUint16(at) : view.getUint32(at);
        at += version < 1 ? 2 : 4;
        const associations = view.getUint8(at);
        at += 1;
        for (let j = 0; j < associations; j += 1) {
          const index = wideIndex ? view.getUint16(at) & 32767 : view.getUint8(at) & 127;
          at += wideIndex ? 2 : 1;
          if (item !== primary || index === 0)
            continue;
          const property = properties[index - 1];
          if ((property == null ? void 0 : property.type) === "ispe") {
            width = view.getUint32(property.start + 4);
            height = view.getUint32(property.start + 8);
          } else if ((property == null ? void 0 : property.type) === "irot") {
            quarterTurns = view.getUint8(property.start) & 3;
          }
        }
      }
    }
    if (!width || !height)
      return null;
    return quarterTurns % 2 === 1 ? { width: height, height: width } : { width, height };
  } catch {
    return null;
  }
}
export {
  TEXT_CODE_EXTENSIONS as T,
  stripMediaTypeParams as a,
  extensionOf as e,
  heifImageSize as h,
  isoBoxes as i,
  mediaTypeFromExtension as m,
  sniffMagic as s
};
//# sourceMappingURL=content_mime-e42d5f8d.mjs.map
