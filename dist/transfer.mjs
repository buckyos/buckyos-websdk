import { isTransferableRef, parseObjRefString, contentRefString, readZoneContent, readContentHints } from "./content.mjs";
import "./object_url-20e94b67.mjs";
import "./ndn_types-0fac2499.mjs";
const NAMED = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  yen: "¥",
  euro: "€",
  pound: "£",
  cent: "¢",
  copy: "©",
  reg: "®",
  trade: "™",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  laquo: "«",
  raquo: "»",
  times: "×",
  divide: "÷",
  deg: "°",
  middot: "·",
  bull: "•",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”"
};
function decodeHtmlEntities(text) {
  if (!text.includes("&"))
    return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);?/g, (all, ref) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 1114111 ? String.fromCodePoint(code) : all;
    }
    return NAMED[ref.toLowerCase()] ?? all;
  });
}
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function tokenizeHtml(html) {
  const out = [];
  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      out.push(html.slice(i));
      break;
    }
    if (lt > i)
      out.push(html.slice(i, lt));
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (html[lt + 1] === "!" || html[lt + 1] === "?") {
      const end = html.indexOf(">", lt);
      i = end < 0 ? n : end + 1;
      continue;
    }
    const close = html[lt + 1] === "/";
    let j = lt + (close ? 2 : 1);
    const nameStart = j;
    while (j < n && /[A-Za-z0-9:_-]/.test(html[j]))
      j++;
    const name = html.slice(nameStart, j).toLowerCase();
    if (!name) {
      out.push("<");
      i = lt + 1;
      continue;
    }
    const attrs = {};
    let self = false;
    while (j < n && html[j] !== ">") {
      if (/\s/.test(html[j])) {
        j++;
        continue;
      }
      if (html[j] === "/") {
        self = true;
        j++;
        continue;
      }
      let k = j;
      while (k < n && !/[\s=>/]/.test(html[k]))
        k++;
      const attr = html.slice(j, k).toLowerCase();
      j = k;
      while (j < n && /\s/.test(html[j]))
        j++;
      if (html[j] !== "=") {
        if (attr)
          attrs[attr] = "";
        continue;
      }
      j++;
      while (j < n && /\s/.test(html[j]))
        j++;
      let value;
      if (html[j] === '"' || html[j] === "'") {
        const q = html[j];
        const end = html.indexOf(q, j + 1);
        value = html.slice(j + 1, end < 0 ? n : end);
        j = end < 0 ? n : end + 1;
      } else {
        let k2 = j;
        while (k2 < n && !/[\s>]/.test(html[k2]))
          k2++;
        value = html.slice(j, k2);
        j = k2;
      }
      if (attr && !(attr in attrs))
        attrs[attr] = decodeHtmlEntities(value);
    }
    i = j + 1;
    out.push({ name, attrs, close, self });
    if (!close && (name === "script" || name === "style" || name === "textarea" || name === "title")) {
      const end = html.toLowerCase().indexOf(`</${name}`, i);
      i = end < 0 ? n : html.indexOf(">", end) + 1 || n;
      out.push({ name, attrs: {}, close: true, self: false });
    }
  }
  return out;
}
const CONTENT_REFS_FORMAT = "application/vnd.buckyos.content-refs+json";
const TRANSFER_HANDLE_FORMAT = "application/vnd.buckyos.transfer+json";
const TYPED_TABLE_ATTR = "data-buckyos-table";
const TYPED_VALUE_ATTR = "data-buckyos-value";
const CONTENT_REF_ATTR = "data-buckyos-ref";
const TRANSFER_HANDLE_ATTR = "data-buckyos-transfer";
const webClipboardFormat = (format) => `web ${format}`;
const ASYNC_STANDARD = ["text/plain", "text/html", "image/png"];
const MAX_CONTENT_REFS = 1e4;
const parseJson = (s) => {
  if (!s)
    return void 0;
  try {
    return JSON.parse(s);
  } catch {
    return void 0;
  }
};
const isRecord = (v) => !!v && typeof v === "object" && !Array.isArray(v);
function parseBuckyosAddress(text) {
  const value = text.trim();
  if (!value || value.length > 8192 || /[\t\r\n]/.test(value))
    return void 0;
  if (value.startsWith("cyfs:///")) {
    const raw = value.slice("cyfs://".length);
    if (/[?#]/.test(raw))
      return void 0;
    const parts = raw.split("/").slice(1);
    if (parts.length && parts[parts.length - 1] === "")
      parts.pop();
    const segments = [];
    for (const part of parts) {
      let segment;
      try {
        segment = decodeURIComponent(part);
      } catch {
        return void 0;
      }
      if (!segment || segment === "." || segment === ".." || segment.length > 255 || /[/\\\0]/.test(segment))
        return void 0;
      segments.push(segment);
    }
    const ref = { kind: "cyfs-path", path: `cyfs:///${segments.join("/")}` };
    return isTransferableRef(ref) ? ref : void 0;
  }
  if (value.startsWith("obj://")) {
    const ref = parseObjRefString(value);
    return ref && isTransferableRef(ref) ? ref : void 0;
  }
  return void 0;
}
function buckyosAddressUri(ref) {
  if (ref.kind !== "cyfs-path")
    return contentRefString(ref);
  return "cyfs:///" + ref.path.slice("cyfs:///".length).split("/").filter(Boolean).map(encodeURIComponent).join("/");
}
function readBuckyosAddresses(text, options = {}) {
  if (!text)
    return void 0;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !(options.uriList && l.startsWith("#")));
  if (!lines.length || lines.length > MAX_CONTENT_REFS)
    return void 0;
  const refs = [];
  for (const line of lines) {
    const ref = parseBuckyosAddress(line);
    if (!ref)
      return void 0;
    refs.push(ref);
  }
  return refs;
}
const nameOf = (item) => {
  if (item.hints.name)
    return item.hints.name;
  const tail = item.source.kind === "cyfs-path" ? item.source.path : item.source.innerPath ?? item.source.objectId;
  return tail.split("/").filter(Boolean).pop() ?? contentRefString(item.source);
};
function contentRefsValue(items) {
  return JSON.stringify({ v: 1, items });
}
function readContentRefs(value) {
  const v = parseJson(value);
  if (!isRecord(v) || v.v !== 1 || !Array.isArray(v.items) || !v.items.length || v.items.length > MAX_CONTENT_REFS)
    return void 0;
  const items = [];
  for (const raw of v.items) {
    const item = readZoneContent(raw);
    if (!item)
      return void 0;
    items.push(item);
  }
  return items;
}
function contentRefsHtml(items) {
  return `<meta charset="utf-8">${items.map(
    (item) => `<a href="${escapeHtml(buckyosAddressUri(item.source))}" ${CONTENT_REF_ATTR}="${escapeHtml(JSON.stringify({ v: 1, kind: item.kind }))}">${escapeHtml(nameOf(item))}</a>`
  ).join("<br>")}`;
}
function contentRefsFromHtml(html) {
  if (!html || !html.includes(CONTENT_REF_ATTR))
    return void 0;
  const items = [];
  let open = null;
  const finish = () => {
    if (!open)
      return;
    const name = open.text.replace(/\s+/g, " ").trim();
    items.push({ origin: "zone", kind: open.kind, source: open.source, hints: readContentHints({ name }) });
    open = null;
  };
  for (const token of tokenizeHtml(html)) {
    if (typeof token === "string") {
      if (open)
        open.text += decodeHtmlEntities(token);
      continue;
    }
    if (token.name !== "a")
      continue;
    if (token.close) {
      finish();
      continue;
    }
    finish();
    if (!(CONTENT_REF_ATTR in token.attrs))
      continue;
    const mark = parseJson(token.attrs[CONTENT_REF_ATTR]);
    const source = parseBuckyosAddress(token.attrs.href ?? "");
    if (!isRecord(mark) || mark.v !== 1 || mark.kind !== "file" && mark.kind !== "folder" || !source)
      return void 0;
    open = { source, kind: mark.kind, text: "" };
    if (items.length >= MAX_CONTENT_REFS)
      return void 0;
  }
  finish();
  return items.length ? items : void 0;
}
function contentRefsRepresentations(items) {
  return {
    [CONTENT_REFS_FORMAT]: contentRefsValue(items),
    "text/plain": items.map(nameOf).join("\n"),
    "text/uri-list": items.map((item) => buckyosAddressUri(item.source)).join("\r\n"),
    "text/html": contentRefsHtml(items)
  };
}
const TABLE_FIELD_TYPES = ["text", "boolean", "number", "decimal", "date", "datetime", "select", "multi_select", "currency", "json"];
const isCurrencyCode = (v) => typeof v === "string" && /^[A-Z]{3}$/.test(v);
function readField(raw) {
  if (!isRecord(raw) || typeof raw.name !== "string" || !TABLE_FIELD_TYPES.includes(raw.type))
    return void 0;
  const field = { name: raw.name, type: raw.type };
  if (raw.scale !== void 0) {
    if (!Number.isInteger(raw.scale) || raw.scale < 0 || raw.scale > 18 || field.type !== "decimal" && field.type !== "currency")
      return void 0;
    field.scale = raw.scale;
  }
  if (raw.currency !== void 0) {
    if (!isCurrencyCode(raw.currency) || field.type !== "currency")
      return void 0;
    field.currency = raw.currency;
  }
  if (raw.options !== void 0) {
    if (!Array.isArray(raw.options) || !raw.options.every((o) => typeof o === "string") || field.type !== "select" && field.type !== "multi_select")
      return void 0;
    field.options = raw.options;
  }
  return field;
}
function isTypedTableValue(field, value) {
  switch (field.type) {
    case "text":
    case "select":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "decimal":
      return typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value);
    case "date":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
    case "datetime":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value);
    case "multi_select":
      return Array.isArray(value) && value.every((v) => typeof v === "string");
    case "currency":
      return isRecord(value) && typeof value.amount === "string" && isCurrencyCode(value.currency);
    case "json":
      return isRecord(value) || Array.isArray(value);
  }
}
function typedTableText(field, value) {
  if (value === void 0 || value === null)
    return "";
  switch (field.type) {
    case "boolean":
      return value === true ? "TRUE" : "FALSE";
    case "multi_select":
      return (Array.isArray(value) ? value : []).map(String).join(", ");
    case "currency":
      return isRecord(value) ? `${value.currency} ${value.amount}` : String(value);
    case "json":
      return JSON.stringify(value);
    default:
      return typeof value === "string" || typeof value === "number" ? String(value) : JSON.stringify(value);
  }
}
function typedTableTsvCell(field, value) {
  const text = typedTableText(field, value);
  return /[\t\n\r"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function typedTableRepresentations(table) {
  const { fields, rows } = table;
  const lines = [fields.map((f) => typedTableTsvCell({ name: f.name, type: "text" }, f.name)).join("	")];
  for (const row of rows)
    lines.push(fields.map((f, i) => {
      var _a;
      return typedTableTsvCell(f, (_a = row[i]) == null ? void 0 : _a.value);
    }).join("	"));
  const meta = { v: 1, fields: fields.map((f) => ({ name: f.name, type: f.type, ...f.scale !== void 0 ? { scale: f.scale } : {}, ...f.currency ? { currency: f.currency } : {}, ...f.options ? { options: f.options } : {} })) };
  const head = `<tr>${fields.map((f) => `<th>${escapeHtml(f.name)}</th>`).join("")}</tr>`;
  const body = rows.map((row) => `<tr>${fields.map((f, i) => {
    const cell = row[i];
    if (!cell || cell.value === void 0 && !cell.text)
      return "<td></td>";
    const text = cell.text ?? typedTableText(f, cell.value);
    const value = cell.value === void 0 || cell.value === null ? "" : ` ${TYPED_VALUE_ATTR}="${escapeHtml(JSON.stringify(cell.value))}"`;
    return `<td${value}>${escapeHtml(text).replace(/\r?\n/g, "<br>")}</td>`;
  }).join("")}</tr>`).join("");
  return {
    "text/html": `<meta charset="utf-8"><table ${TYPED_TABLE_ATTR}="${escapeHtml(JSON.stringify(meta))}"><thead>${head}</thead><tbody>${body}</tbody></table>`,
    "text/plain": lines.join("\r\n") + "\r\n"
  };
}
function readTypedTableFields(attr) {
  const meta = parseJson(attr);
  if (!isRecord(meta) || meta.v !== 1 || !Array.isArray(meta.fields) || !meta.fields.length)
    return void 0;
  const fields = [];
  for (const raw of meta.fields) {
    const field = readField(raw);
    if (!field)
      return void 0;
    fields.push(field);
  }
  return fields;
}
function readTypedTable(html) {
  if (!html || !html.includes(TYPED_TABLE_ATTR))
    return void 0;
  let fields;
  const rows = [];
  let depth = 0;
  let row = null;
  let cell = null;
  const endCell = () => {
    if (!cell || !row || !fields) {
      cell = null;
      return;
    }
    const field = fields[row.cells.length];
    const text = cell.text.replace(/[ \t\r\n\f]+/g, " ").replace(/\u2028/g, "\n").trim();
    const raw = cell.attrs[TYPED_VALUE_ATTR];
    const value = raw === void 0 ? void 0 : parseJson(raw);
    row.cells.push({ ...field && value !== void 0 && isTypedTableValue(field, value) ? { value } : {}, ...text ? { text } : {} });
    if (!cell.th)
      row.header = false;
    cell = null;
  };
  const endRow = () => {
    endCell();
    if (row && fields && !(row.header && row.cells.length)) {
      while (row.cells.length < fields.length)
        row.cells.push({});
      rows.push(row.cells.slice(0, fields.length));
    }
    row = null;
  };
  for (const token of tokenizeHtml(html)) {
    if (typeof token === "string") {
      if (cell && depth === 1)
        cell.text += decodeHtmlEntities(token);
      continue;
    }
    const tag = token;
    if (tag.name === "table") {
      if (tag.close) {
        if (!depth)
          continue;
        depth -= 1;
        if (!depth) {
          endRow();
          break;
        }
      } else if (!tag.self) {
        if (depth) {
          depth += 1;
          continue;
        }
        if (!(TYPED_TABLE_ATTR in tag.attrs))
          continue;
        fields = readTypedTableFields(tag.attrs[TYPED_TABLE_ATTR]);
        if (!fields)
          return void 0;
        depth = 1;
      }
      continue;
    }
    if (depth !== 1)
      continue;
    if (tag.name === "tr") {
      endRow();
      if (!tag.close)
        row = { cells: [], header: true };
    } else if (tag.name === "td" || tag.name === "th") {
      endCell();
      if (!tag.close) {
        row ?? (row = { cells: [], header: true });
        cell = { attrs: tag.attrs, text: "", th: tag.name === "th" };
      }
    } else if (tag.name === "br" && cell)
      cell.text += "\u2028";
  }
  return fields ? { fields, rows } : void 0;
}
const OFFER_ID = /^[A-Za-z0-9_-]{16,128}$/;
function newOfferId() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const transferHandleValue = (offerId, options = {}) => JSON.stringify(options.cut ? { v: 1, offerId, cut: true } : { v: 1, offerId });
function readTransferHandle(value) {
  const v = parseJson(value);
  if (!isRecord(v) || v.v !== 1 || typeof v.offerId !== "string" || !OFFER_ID.test(v.offerId))
    return void 0;
  return v.cut === true ? { v: 1, offerId: v.offerId, cut: true } : { v: 1, offerId: v.offerId };
}
function embedTransferHandle(html, offerId, options = {}) {
  const body = html.replace(/^<meta charset="utf-8">/i, "");
  return `<meta charset="utf-8"><div ${TRANSFER_HANDLE_ATTR}="${escapeHtml(transferHandleValue(offerId, options))}">${body}</div>`;
}
function transferHandleFromHtml(html) {
  if (!html || !html.includes(TRANSFER_HANDLE_ATTR))
    return void 0;
  for (const token of tokenizeHtml(html)) {
    if (typeof token !== "string" && !token.close && TRANSFER_HANDLE_ATTR in token.attrs)
      return readTransferHandle(token.attrs[TRANSFER_HANDLE_ATTR]);
  }
  return void 0;
}
function transferTypes(dt) {
  return dt ? Array.from(dt.types ?? [], (t) => t.toLowerCase()) : [];
}
function snapshotDataTransfer(dt) {
  if (!dt)
    return { types: [], data: {}, files: [] };
  const types = transferTypes(dt);
  const data = {};
  for (const type of types) {
    if (type === "files")
      continue;
    try {
      const value = dt.getData(type);
      if (value)
        data[type] = value;
    } catch {
    }
  }
  return { types, data, files: Array.from(dt.files ?? []) };
}
function writeDataTransfer(dt, representations) {
  for (const [format, value] of Object.entries(representations))
    if (value !== void 0)
      dt.setData(format, value);
}
const clipboardItemSupports = (type) => {
  const item = globalThis.ClipboardItem;
  if (!item)
    return false;
  if (typeof item.supports === "function") {
    try {
      return item.supports(type);
    } catch {
      return false;
    }
  }
  return ASYNC_STANDARD.includes(type);
};
async function writeClipboard(representations, options = {}) {
  var _a;
  const clipboard = (_a = globalThis.navigator) == null ? void 0 : _a.clipboard;
  if (!clipboard)
    throw new Error("The clipboard is not available");
  const standard = {};
  const custom = {};
  for (const [format, value] of Object.entries(representations)) {
    if (ASYNC_STANDARD.includes(format))
      standard[format] = new Blob([value], { type: format });
    else if (clipboardItemSupports(webClipboardFormat(format)))
      custom[webClipboardFormat(format)] = new Blob([value], { type: format });
  }
  for (const [format, blob] of Object.entries(options.images ?? {}))
    if (clipboardItemSupports(format))
      standard[format] = blob;
  const Item = globalThis.ClipboardItem;
  if (Item && typeof clipboard.write === "function") {
    for (const items of Object.keys(custom).length ? [{ ...standard, ...custom }, standard] : [standard]) {
      if (!Object.keys(items).length)
        continue;
      try {
        await clipboard.write([new Item(items)]);
        return Object.keys(items).map((f) => f.replace(/^web /, ""));
      } catch {
      }
    }
  }
  if (representations["text/plain"] !== void 0 && typeof clipboard.writeText === "function") {
    await clipboard.writeText(representations["text/plain"]);
    return ["text/plain"];
  }
  throw new Error("Nothing could be written to the clipboard");
}
const isTextFormat = (type) => type.startsWith("text/") || type.endsWith("+json") || type === "application/json";
async function readClipboard() {
  var _a;
  const clipboard = (_a = globalThis.navigator) == null ? void 0 : _a.clipboard;
  if (!clipboard)
    throw new Error("The clipboard is not available");
  const out = { types: [], data: {}, files: [] };
  if (typeof clipboard.read !== "function") {
    const text = await clipboard.readText();
    if (text) {
      out.types.push("text/plain");
      out.data["text/plain"] = text;
    }
    return out;
  }
  for (const item of await clipboard.read()) {
    for (const type of item.types) {
      const name = type.replace(/^web /, "").toLowerCase();
      if (!out.types.includes(name))
        out.types.push(name);
      const blob = await item.getType(type);
      if (isTextFormat(name)) {
        if (!(name in out.data))
          out.data[name] = await blob.text();
      } else if (name.startsWith("image/") && typeof File !== "undefined")
        out.files.push(new File([blob], `clipboard.${name.slice(6).split("+")[0]}`, { type: name }));
    }
  }
  if (out.files.length && !out.types.includes("files"))
    out.types.push("files");
  return out;
}
function transferReader(snapshot) {
  const get = (format) => snapshot.data[format.toLowerCase()];
  const once = (read) => {
    let done = false;
    let value;
    return () => {
      if (!done) {
        value = read();
        done = true;
      }
      return value;
    };
  };
  return {
    snapshot,
    has: (format) => snapshot.types.includes(format.toLowerCase()),
    get,
    handle: once(() => readTransferHandle(get(TRANSFER_HANDLE_FORMAT)) ?? transferHandleFromHtml(get("text/html"))),
    contentRefs: once(() => {
      const mime = readContentRefs(get(CONTENT_REFS_FORMAT));
      if (mime)
        return { items: mime, via: "mime" };
      const html = contentRefsFromHtml(get("text/html"));
      return html ? { items: html, via: "html" } : void 0;
    }),
    typedTable: once(() => readTypedTable(get("text/html"))),
    addresses: once(() => readBuckyosAddresses(get("text/uri-list"), { uriList: true }) ?? readBuckyosAddresses(get("text/plain"))),
    files: snapshot.files,
    html: get("text/html"),
    text: get("text/plain")
  };
}
const mayCarryContentRefs = (types) => types.includes(CONTENT_REFS_FORMAT) || types.includes("text/html") || types.includes("text/uri-list");
export {
  CONTENT_REFS_FORMAT,
  CONTENT_REF_ATTR,
  MAX_CONTENT_REFS,
  TABLE_FIELD_TYPES,
  TRANSFER_HANDLE_ATTR,
  TRANSFER_HANDLE_FORMAT,
  TYPED_TABLE_ATTR,
  TYPED_VALUE_ATTR,
  buckyosAddressUri,
  contentRefsFromHtml,
  contentRefsHtml,
  contentRefsRepresentations,
  contentRefsValue,
  embedTransferHandle,
  isTypedTableValue,
  mayCarryContentRefs,
  newOfferId,
  parseBuckyosAddress,
  readBuckyosAddresses,
  readClipboard,
  readContentRefs,
  readTransferHandle,
  readTypedTable,
  readTypedTableFields,
  snapshotDataTransfer,
  transferHandleFromHtml,
  transferHandleValue,
  transferReader,
  transferTypes,
  typedTableRepresentations,
  typedTableText,
  typedTableTsvCell,
  webClipboardFormat,
  writeClipboard,
  writeDataTransfer
};
//# sourceMappingURL=transfer.mjs.map
