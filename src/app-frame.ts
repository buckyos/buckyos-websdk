import { isOpenRequest, isTransferableRef, isTransferableSession, readContentHints, readSelectDialogResult, readZoneContent, systemOpenUrl, SELECT_DIALOG_PATH, SystemDialogError, SYSTEM_DIALOG_ERROR_CODES, type ContentHints, type ContentOpenTarget, type OpenRequest, type SelectDialogParams, type SelectDialogResult, type SystemDialogErrorCode, type TransferableContentRef, type TransferableSessionContext, type ZoneContent } from './content'
import { readAppOpenRequest, systemOpenAppUrl, type AppOpenRequest } from './open_app'
import { getBuckyApi, type BuckyApi, type RuntimeContainer } from './runtime_env'
import { CONTENT_REFS_FORMAT, MAX_CONTENT_REFS, newOfferId, readContentRefs } from './transfer'
export type SystemDialogReply = { ok: true; result: unknown } | { ok: false; code: SystemDialogErrorCode }
const dialogErrorCode = (value: unknown): SystemDialogErrorCode =>
  SYSTEM_DIALOG_ERROR_CODES.includes(value as SystemDialogErrorCode) ? value as SystemDialogErrorCode : 'protocol'
export interface AppFrameMessage<T extends string = string, P = unknown> {
  protocol: 'buckyos.app-frame'; version: 1; type: T; id?: string; replyTo?: string; payload: P
}
export interface FrameInit {
  nonce: string
  windowId: string
  formFactor: 'desktop' | 'mobile'
  theme: { mode: 'light' | 'dark'; accent?: string }
  locale: string
  launch?: OpenRequest
  shellCapabilities: string[]
  /** `tab`: the App fills a tab of the host, which has its own navigation, so the App leaves out its outer one. */
  presentation?: 'window' | 'tab'
  container?: RuntimeContainer
}
export type CloseDecision = 'allow' | 'deny' | 'pending'
export type AppOpenErrorCode = 'not_found' | 'denied' | 'unsupported'
export type AppOpenReply = { ok: true } | { ok: false; code: AppOpenErrorCode }
export interface HeaderItem { id: string; label: string; active?: boolean }
/** `icon`: the name of an icon, or the address of an image. */
export interface HeaderMenuItem { id: string; label: string; icon?: string; danger?: boolean }
/**
 * What an App puts into the header the host draws above it (mobile containers; elsewhere it is ignored). A field left
 * out keeps its value; an empty list, or `null` for the search, removes it.
 */
export interface HeaderState {
  title?: string
  /** A second row below the title, such as tabs. Only a `standard` header has room for it. */
  second_row?: HeaderItem[]
  search?: { placeholder?: string; value?: string } | null
  menu?: HeaderMenuItem[]
  /** Whether the back button applies inside the App; pressing it arrives as `frame.back`. */
  back?: boolean
}
/** `search`: `value` is the text; `item` and `menu`: `id` is the entry that was chosen. */
export interface HeaderEvent { kind: 'search' | 'item' | 'menu'; id?: string; value?: string }
const text = (value: unknown, max: number): string | undefined => typeof value === 'string' ? value.slice(0, max) : undefined
function readHeaderList<T extends HeaderMenuItem | HeaderItem>(value: unknown, read: (v: Record<string, unknown>, base: { id: string; label: string }) => T): T[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 32).flatMap((entry: unknown) => {
    const v = entry as Record<string, unknown> | null
    if (!v || typeof v !== 'object' || typeof v.id !== 'string' || !v.id || v.id.length > 128 || typeof v.label !== 'string') return []
    return [read(v, { id: v.id, label: v.label.slice(0, 128) })]
  })
}
/** Reads the header an App asks for; only the fields it gave are in the result. */
function readHeader(p: Record<string, unknown>): HeaderState {
  const header: HeaderState = {}
  const title = text(p.title, 256)
  if (title !== undefined) header.title = title
  if (Array.isArray(p.second_row)) header.second_row = readHeaderList<HeaderItem>(p.second_row, (v, base) => ({ ...base, ...(v.active === true ? { active: true } : {}) }))
  if (Array.isArray(p.menu)) header.menu = readHeaderList<HeaderMenuItem>(p.menu, (v, base) => ({ ...base, ...(typeof v.icon === 'string' ? { icon: v.icon.slice(0, 2048) } : {}), ...(v.danger === true ? { danger: true } : {}) }))
  if (p.search === null) header.search = null
  else if (p.search && typeof p.search === 'object') {
    const search = p.search as Record<string, unknown>
    const placeholder = text(search.placeholder, 128), value = text(search.value, 1024)
    header.search = { ...(placeholder !== undefined ? { placeholder } : {}), ...(value !== undefined ? { value } : {}) }
  }
  if (typeof p.back === 'boolean') header.back = p.back
  return header
}
/**
 * A channel to one peer that the platform has already identified. The native client's bridge is one: it knows which
 * view a message comes from, so there is no origin to check.
 */
export interface AppFrameTransport {
  /** `transfer`: objects moved with the message (a window transport only: the `MessagePort` of `transfer.connect`). */
  post(message: AppFrameMessage, transfer?: Transferable[]): void
  /** `ports`: the ports that came with the message (a window transport only). */
  onMessage(cb: (message: unknown, ports?: readonly MessagePort[]) => void): () => void
}
/** The channel to another window: messages count only when they come from that window and that origin. */
function windowTransport(peer: () => Window | null, origin: string): AppFrameTransport {
  return {
    post: (message, transfer) => peer()?.postMessage(message, origin, transfer ?? []),
    onMessage: cb => {
      const own = window
      const listener = (event: MessageEvent) => { if (event.source === peer() && event.origin === origin) cb(event.data, event.ports) }
      own.addEventListener('message', listener)
      return () => own.removeEventListener('message', listener)
    },
  }
}
function bridgeTransport(api: BuckyApi): AppFrameTransport {
  return {
    post: message => { void Promise.resolve(api.call('frame.post', message)).catch(() => {}) },
    onMessage: cb => api.on('frame.message', cb),
  }
}
const envelope = (type: string, payload: unknown, extra: { id?: string; replyTo?: string } = {}): AppFrameMessage =>
  ({ protocol: 'buckyos.app-frame', version: 1, type, payload, ...extra })
const isMessage = (value: unknown): value is AppFrameMessage => {
  if (!value || typeof value !== 'object') return false
  const v = value as AppFrameMessage
  return v.protocol === 'buckyos.app-frame' && v.version === 1 && typeof v.type === 'string' && !!v.payload && typeof v.payload === 'object'
}

// ─── transfer.v1: content delivered through the Shell (剪贴板规范 §5) ───
//
// After `frame.init` an App that declared `transfer.v1` (to a Shell that lists it) creates a `MessageChannel` and sends
// `transfer.connect { documentId }` with one port, to the exact Shell origin. The Shell takes it only from the window,
// origin and handshake it checked, binds the port to that document, and drops the port and every request waiting on it
// when another document says hello (a reload or navigation) or connects again. Every `transfer.*` message travels on
// the port, in the App Frame envelope; requests are answered with `<type>Result`.
//
// In the BuckyOS client (a bridge, no window) no port can cross: `transfer.connect` and the `transfer.*` messages go
// over the bridge itself, which already knows the view, and a new document is a new handshake nonce. Local files cannot
// cross the bridge, so a `files` value is `unsupported` there.

/** The capability both sides list to deliver content through the Shell. */
export const TRANSFER_CAPABILITY = 'transfer.v1'
export type TransferItemKind = 'zone-file' | 'zone-folder' | 'local-file' | 'text' | 'object'
export type TransferOperationKind = 'copy' | 'move' | 'link'
export type TransferOfferPurpose = 'copy' | 'cut' | 'drag'
/** `unsupported`: an unknown version or no common representation; `stale`: the selection or document changed;
 * `denied`: refused by permission or policy. */
export type TransferErrorCode = 'unsupported' | 'stale' | 'denied'
export const TRANSFER_ERROR_CODES: readonly TransferErrorCode[] = ['unsupported', 'stale', 'denied']
/** A transfer request failed: one of the protocol codes, or `timeout` when no answer came in time. */
export class TransferError extends Error {
  constructor(public code: TransferErrorCode | 'timeout', message?: string) { super(message ?? `Transfer: ${code}`); this.name = 'TransferError' }
}
/** One item of a selection an App offers: what it is and which registered formats (§2.1 names, no `web ` prefix) and
 * operations it can give. `inline`: small string representations the Shell may keep and deliver without asking back. */
export interface TransferOfferItem {
  kind: TransferItemKind
  formats: string[]
  operations: TransferOperationKind[]
  inline?: Record<string, string>
}
/** `transfer.offer` (App → Shell): registers a selection under the App's own high-entropy `offerId`. `generation`
 * counts the App's selections; `transfer.read` gives it back so the App can answer `stale` for an older one. */
export interface TransferOfferMessage {
  offerId: string
  purpose: TransferOfferPurpose
  generation: number
  items: TransferOfferItem[]
  scope?: Record<string, string>
}
/** One item as a probe shows it: its key in the selection (`0`, `1`, …), kind, formats and operations only. */
export interface TransferProbeItem { itemKey: string; kind: TransferItemKind; formats: string[]; operations: TransferOperationKind[] }
/** A point in the App's page (CSS pixels of its viewport), or its current focus (a paste command). */
export type TransferPoint = { x: number; y: number } | 'focus'
/** `transfer.probe` (Shell → target): what would you do with these items here? Nothing may be read or changed. */
export interface TransferProbe { operationId: string; seq: number; items: TransferProbeItem[]; at: TransferPoint }
/** A probe's answer: the target's own id for the drop place, the representation and operation per accepted item, and
 * the action the user is shown ("Insert at the cursor"). */
export interface TransferProbeAnswer {
  targetId: string
  accept: Array<{ itemKey: string; format: string; operation: TransferOperationKind }>
  action: string
}
/** `transfer.read` (Shell → source), once the user let go on or chose a destination. */
export interface TransferReadRequest { operationId: string; offerId: string; generation: number; items: Array<{ itemKey: string; format: string }> }
export type TransferReadValue =
  | { itemKey: string; format: string; value: unknown }
  | { itemKey: string; format: string; error: TransferErrorCode | 'failed' }
/**
 * A representation's value: a string for text and JSON formats; for `application/vnd.buckyos.content-refs+json` the
 * item's `ZoneContent`; for `files` a `File`; a `Blob` for binary formats (`image/png`).
 */
export interface TransferDeliveryItem { itemKey: string; format: string; value: unknown }
/** `transfer.deliver` (Shell → the chosen target). The target checks the place, version and permissions again and
 * commits once per `operationId`. */
export interface TransferDelivery { operationId: string; targetId: string; operation: TransferOperationKind; at: TransferPoint; items: TransferDeliveryItem[] }
export type TransferItemStatus = 'done' | 'accepted' | 'skipped' | 'failed' | 'cancelled'
/** `done`: committed; `accepted`: taken, waiting for the user (a draft, an import dialog); `cancelled`; `failed`. */
export interface TransferDeliveryResult {
  status: 'done' | 'accepted' | 'cancelled' | 'failed'
  items: Array<{ itemKey: string; status: TransferItemStatus; error?: string }>
}

const TRANSFER_ID = /^[A-Za-z0-9_-]{16,128}$/
const DOCUMENT_ID = /^[A-Za-z0-9_-]{8,128}$/
const FORMAT_NAME = /^(?:files|[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126})$/
const ITEM_KINDS: readonly TransferItemKind[] = ['zone-file', 'zone-folder', 'local-file', 'text', 'object']
const OPERATIONS: readonly TransferOperationKind[] = ['copy', 'move', 'link']
const ITEM_STATUSES: readonly TransferItemStatus[] = ['done', 'accepted', 'skipped', 'failed', 'cancelled']
const MAX_FORMATS = 32
const MAX_INLINE = 1024 * 1024
const MAX_STRING_VALUE = 16 * 1024 * 1024
const TRANSFER_TIMEOUT = { offer: 5000, probe: 1500, read: 10000, deliver: 15000, status: 3000 }
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isTransferId = (v: unknown): v is string => typeof v === 'string' && TRANSFER_ID.test(v)
const isItemKey = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9]\d{0,5})$/.test(v)
const isFormat = (v: unknown): v is string => typeof v === 'string' && FORMAT_NAME.test(v)
const readOperations = (v: unknown): TransferOperationKind[] | undefined => {
  if (!Array.isArray(v) || !v.length || v.length > 3 || !v.every(o => OPERATIONS.includes(o))) return undefined
  return [...new Set(v as TransferOperationKind[])]
}
const readFormats = (v: unknown): string[] | undefined =>
  Array.isArray(v) && v.length && v.length <= MAX_FORMATS && v.every(isFormat) ? [...new Set(v as string[])] : undefined
const readPoint = (v: unknown): TransferPoint | undefined => {
  if (v === 'focus') return 'focus'
  return isObject(v) && Number.isFinite(v.x) && Number.isFinite(v.y) ? { x: v.x as number, y: v.y as number } : undefined
}
const readStringMap = (v: unknown, maxEntries: number, maxLength: number): Record<string, string> | undefined => {
  if (!isObject(v)) return undefined
  const entries = Object.entries(v)
  if (entries.length > maxEntries || !entries.every(([key, value]) => key.length <= 128 && typeof value === 'string' && value.length <= maxLength)) return undefined
  return Object.fromEntries(entries) as Record<string, string>
}
const transferCode = (v: unknown): TransferErrorCode => TRANSFER_ERROR_CODES.includes(v as TransferErrorCode) ? v as TransferErrorCode : 'unsupported'

/** Checks a `transfer.offer` an App sent; undefined when it does not follow the schema. */
export function readTransferOffer(value: unknown): TransferOfferMessage | undefined {
  if (!isObject(value) || !isTransferId(value.offerId) || !['copy', 'cut', 'drag'].includes(value.purpose as string)) return undefined
  if (!Number.isSafeInteger(value.generation) || (value.generation as number) < 0) return undefined
  if (!Array.isArray(value.items) || !value.items.length || value.items.length > MAX_CONTENT_REFS) return undefined
  let inlineSize = 0
  const items: TransferOfferItem[] = []
  for (const raw of value.items) {
    if (!isObject(raw) || !ITEM_KINDS.includes(raw.kind as TransferItemKind)) return undefined
    const formats = readFormats(raw.formats), operations = readOperations(raw.operations)
    if (!formats || !operations) return undefined
    const item: TransferOfferItem = { kind: raw.kind as TransferItemKind, formats, operations }
    if (raw.inline !== undefined) {
      const inline = readStringMap(raw.inline, MAX_FORMATS, MAX_INLINE)
      if (!inline || !Object.keys(inline).every(f => formats.includes(f))) return undefined
      inlineSize += Object.values(inline).reduce((n, s) => n + s.length, 0)
      if (inlineSize > MAX_INLINE) return undefined
      item.inline = inline
    }
    items.push(item)
  }
  const offer: TransferOfferMessage = { offerId: value.offerId, purpose: value.purpose as TransferOfferPurpose, generation: value.generation as number, items }
  if (value.scope !== undefined) {
    const scope = readStringMap(value.scope, 8, 512)
    if (!scope) return undefined
    offer.scope = scope
  }
  return offer
}

function readProbeItems(value: unknown): TransferProbeItem[] | undefined {
  if (!Array.isArray(value) || !value.length || value.length > MAX_CONTENT_REFS) return undefined
  const items: TransferProbeItem[] = []
  for (const raw of value) {
    if (!isObject(raw) || !isItemKey(raw.itemKey) || !ITEM_KINDS.includes(raw.kind as TransferItemKind)) return undefined
    const formats = readFormats(raw.formats), operations = readOperations(raw.operations)
    if (!formats || !operations) return undefined
    items.push({ itemKey: raw.itemKey, kind: raw.kind as TransferItemKind, formats, operations })
  }
  return items
}

/** Checks a `transfer.probe`. */
export function readTransferProbe(value: unknown): TransferProbe | undefined {
  if (!isObject(value) || !isTransferId(value.operationId) || !Number.isSafeInteger(value.seq)) return undefined
  const items = readProbeItems(value.items), at = readPoint(value.at)
  return items && at ? { operationId: value.operationId, seq: value.seq as number, items, at } : undefined
}

/** Checks a probe's answer against the probe: only items it showed, in formats and operations it allowed, once each.
 * Null when nothing valid is accepted. */
export function readTransferProbeAnswer(value: unknown, probe: Pick<TransferProbe, 'items'>): TransferProbeAnswer | null {
  if (!isObject(value) || typeof value.targetId !== 'string' || !value.targetId || value.targetId.length > 256 || !Array.isArray(value.accept)) return null
  const shown = new Map(probe.items.map(item => [item.itemKey, item]))
  const seen = new Set<string>()
  const accept: TransferProbeAnswer['accept'] = []
  for (const raw of value.accept) {
    if (!isObject(raw) || typeof raw.itemKey !== 'string' || seen.has(raw.itemKey)) continue
    const item = shown.get(raw.itemKey)
    if (!item || !item.formats.includes(raw.format as string) || !item.operations.includes(raw.operation as TransferOperationKind)) continue
    seen.add(raw.itemKey)
    accept.push({ itemKey: raw.itemKey, format: raw.format as string, operation: raw.operation as TransferOperationKind })
  }
  if (!accept.length) return null
  return { targetId: value.targetId, accept, action: typeof value.action === 'string' ? value.action.slice(0, 200) : '' }
}

/** Checks a `transfer.read`. */
export function readTransferReadRequest(value: unknown): TransferReadRequest | undefined {
  if (!isObject(value) || !isTransferId(value.operationId) || !isTransferId(value.offerId) || !Number.isSafeInteger(value.generation)) return undefined
  if (!Array.isArray(value.items) || !value.items.length || value.items.length > MAX_CONTENT_REFS) return undefined
  const items: TransferReadRequest['items'] = []
  for (const raw of value.items) {
    if (!isObject(raw) || !isItemKey(raw.itemKey) || !isFormat(raw.format)) return undefined
    items.push({ itemKey: raw.itemKey, format: raw.format })
  }
  return { operationId: value.operationId, offerId: value.offerId, generation: value.generation as number, items }
}

const isFileValue = (v: unknown): v is File => typeof File !== 'undefined' && v instanceof File
const isBlobValue = (v: unknown): v is Blob => typeof Blob !== 'undefined' && v instanceof Blob
/**
 * A representation's value as it crosses a window, checked by its format; undefined when it does not fit. Content
 * references come back as a clean `ZoneContent` (a one-item reference list string is also taken).
 */
export function readTransferValue(format: string, value: unknown): unknown {
  if (format === CONTENT_REFS_FORMAT) {
    if (typeof value === 'string') { const items = readContentRefs(value); return items?.length === 1 ? items[0] : undefined }
    return readZoneContent(value)
  }
  if (format === 'files') return isFileValue(value) ? value : undefined
  if (typeof value === 'string') return value.length <= MAX_STRING_VALUE ? value : undefined
  return isBlobValue(value) && !format.startsWith('text/') ? value : undefined
}

function readDeliveryItems(value: unknown): TransferDeliveryItem[] | undefined {
  if (!Array.isArray(value) || !value.length || value.length > MAX_CONTENT_REFS) return undefined
  const items: TransferDeliveryItem[] = []
  for (const raw of value) {
    if (!isObject(raw) || !isItemKey(raw.itemKey) || !isFormat(raw.format)) return undefined
    const clean = readTransferValue(raw.format, raw.value)
    if (clean === undefined) return undefined
    items.push({ itemKey: raw.itemKey, format: raw.format, value: clean })
  }
  return items
}

/** Checks a `transfer.deliver`. */
export function readTransferDelivery(value: unknown): TransferDelivery | undefined {
  if (!isObject(value) || !isTransferId(value.operationId) || typeof value.targetId !== 'string' || !value.targetId || value.targetId.length > 256) return undefined
  if (!OPERATIONS.includes(value.operation as TransferOperationKind)) return undefined
  const at = readPoint(value.at), items = readDeliveryItems(value.items)
  return at && items ? { operationId: value.operationId, targetId: value.targetId, operation: value.operation as TransferOperationKind, at, items } : undefined
}

/** Checks a delivery's result: one entry per delivered item (missing ones count as failed). */
export function readTransferDeliveryResult(value: unknown, delivered: Array<{ itemKey: string }>): TransferDeliveryResult | undefined {
  if (!isObject(value) || !['done', 'accepted', 'cancelled', 'failed'].includes(value.status as string) || !Array.isArray(value.items)) return undefined
  const given = new Map<string, { status: TransferItemStatus; error?: string }>()
  for (const raw of value.items) {
    if (!isObject(raw) || typeof raw.itemKey !== 'string' || !ITEM_STATUSES.includes(raw.status as TransferItemStatus)) continue
    given.set(raw.itemKey, { status: raw.status as TransferItemStatus, ...(typeof raw.error === 'string' ? { error: raw.error.slice(0, 200) } : {}) })
  }
  return {
    status: value.status as TransferDeliveryResult['status'],
    items: delivered.map(({ itemKey }) => ({ itemKey, ...(given.get(itemKey) ?? { status: 'failed' as const, error: 'no_result' }) })),
  }
}

/** The values a source gave for a read: exactly the requested pairs, each value checked by its format. */
function readTransferReadValues(value: unknown, request: TransferReadRequest, options: { files: boolean }): TransferReadValue[] {
  const given = new Map<string, unknown>()
  if (Array.isArray(value)) for (const raw of value) {
    if (isObject(raw) && typeof raw.itemKey === 'string' && typeof raw.format === 'string') given.set(`${raw.itemKey}\n${raw.format}`, raw)
  }
  return request.items.map(({ itemKey, format }) => {
    const raw = given.get(`${itemKey}\n${format}`) as Record<string, unknown> | undefined
    if (!raw) return { itemKey, format, error: 'failed' as const }
    if ('error' in raw && raw.error !== undefined) return { itemKey, format, error: raw.error === 'failed' ? 'failed' as const : transferCode(raw.error) }
    if (format === 'files' && !options.files) return { itemKey, format, error: 'unsupported' as const }
    const clean = readTransferValue(format, raw.value)
    return clean === undefined ? { itemKey, format, error: 'failed' as const } : { itemKey, format, value: clean }
  })
}

/** One end of the transfer link: a `MessagePort`, or the bridge. */
interface TransferLink { documentId: string; post(message: AppFrameMessage): void; close(): void }
const portLink = (documentId: string, port: MessagePort, receive: (message: unknown) => void): TransferLink => {
  port.onmessage = event => receive(event.data)
  port.start?.()
  return { documentId, post: message => port.postMessage(message), close: () => { port.onmessage = null; port.close() } }
}

export interface AppFrameHostCallbacks {
  onReady?: () => void
  onTitle?: (title: string, dirty: boolean) => void
  onRequestClose?: () => void
  onContentOpen?: (request: OpenRequest, target: ContentOpenTarget, options: { newWindow: boolean; hints: ContentHints }) => void
  /** Opens another App, or a page of one (`app.open`). Without a `zone` the request is for the App's own Zone. */
  onAppOpen?: (request: AppOpenRequest) => Promise<AppOpenReply> | AppOpenReply
  /** The header the App wants now (`header.set`), with everything it set so far. */
  onHeader?: (header: HeaderState) => void
  /** Shows a system dialog the App asked for (`sysdlg.open`). `params` is untrusted input: validate it. */
  onSystemDialog?: (path: string, params: unknown) => Promise<SystemDialogReply>
  /** `transfer.v1`: a document of the App connected its transfer link (after each handshake of a new document). */
  onTransferConnect?: (documentId: string) => void
  /** The link of that document is gone (reload, navigation, a new connect, dispose): its offers and requests are void. */
  onTransferDisconnect?: (documentId: string) => void
  /** The App registers a selection. `offer` passed the schema; the host rejects an `offerId` it already has. */
  onTransferOffer?: (offer: TransferOfferMessage, documentId: string) => Promise<{ ok: true } | { ok: false; code: TransferErrorCode }> | { ok: true } | { ok: false; code: TransferErrorCode }
  /** The App withdrew a selection it offered (`transfer.cancel { offerId }`). */
  onTransferWithdraw?: (offerId: string, documentId: string) => void
}
const FRAME_NAME_PREFIX = 'buckyos.app-frame:'

/** The iframe name the host sets so an App can use its own URL fragment. */
export function appFrameName(nonce: string): string { return FRAME_NAME_PREFIX + nonce }

/**
 * `target` and `origin`: the App runs in an iframe named with `appFrameName(init.nonce)` or opened with `#bfp=<init.nonce>`. `transport`: the
 * platform connects this host to the App's view; the App picks the nonce and the host answers with it.
 */
export type AppFrameHostOptions = AppFrameHostCallbacks & (
  | { target: () => Window | null; origin: string; init: FrameInit; transport?: undefined }
  | { transport: AppFrameTransport; init: Omit<FrameInit, 'nonce'>; target?: undefined; origin?: undefined })
/** Opening requests an App may send in ten seconds, for each kind. */
const OPEN_LIMIT = 5
export class AppFrameHost {
  ready = false
  capabilities: string[] = []
  header: HeaderState = {}
  private init: FrameInit
  private readonly framed: boolean
  private readonly channel: AppFrameTransport
  private readonly detach: () => void
  private readonly callbacks: AppFrameHostCallbacks
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout>; type: string }>()
  private opens = new Map<string, number[]>()
  constructor(options: AppFrameHostOptions) {
    this.callbacks = options
    this.framed = !options.transport
    this.init = options.transport ? { ...options.init, nonce: '' } : options.init
    this.channel = options.transport ?? windowTransport(options.target, options.origin)
    this.detach = this.channel.onMessage((message, ports) => this.receive(message, ports))
  }
  private focused?: boolean
  private dialogOpen = false
  private transferLink?: TransferLink
  private transferPending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout>; type: string }>()
  /** The App document whose transfer link is bound (`transfer.v1`); undefined when none is. */
  get transferDocument(): string | undefined { return this.transferLink?.documentId }
  private limited(type: string): boolean {
    const recent = (this.opens.get(type) ?? []).filter(t => t > Date.now() - 10000)
    this.opens.set(type, recent)
    if (recent.length >= OPEN_LIMIT) return true
    recent.push(Date.now())
    return false
  }
  private async appOpen(id: string, payload: unknown): Promise<void> {
    const reply = (result: AppOpenReply) => { if (this.ready) this.channel.post(envelope('app.openResult', result, { replyTo: id })) }
    if (!this.callbacks.onAppOpen) return reply({ ok: false, code: 'unsupported' })
    const request = readAppOpenRequest(payload)
    if (!request || this.limited('app.open')) return reply({ ok: false, code: 'denied' })
    try { reply(await this.callbacks.onAppOpen(request)) }
    catch { reply({ ok: false, code: 'denied' }) }
  }
  private async systemDialog(id: string, path: unknown, params: unknown): Promise<void> {
    const reply = (payload: SystemDialogReply) => { if (this.ready) this.channel.post(envelope('sysdlg.openResult', payload, { replyTo: id })) }
    if (!this.callbacks.onSystemDialog || typeof path !== 'string') return reply({ ok: false, code: 'unsupported' })
    if (this.dialogOpen) return reply({ ok: false, code: 'busy' })
    this.dialogOpen = true
    try { reply(await this.callbacks.onSystemDialog(path, params)) }
    catch (error) { reply({ ok: false, code: error instanceof SystemDialogError ? error.code : 'closed' }) }
    finally { this.dialogOpen = false }
  }
  private receive(m: unknown, ports?: readonly MessagePort[]): void {
    if (!isMessage(m)) return
    const p = m.payload as Record<string, unknown>
    if (m.type === 'frame.hello') {
      if (!Array.isArray(p.appCapabilities)) return
      if (this.framed) { if (p.nonce !== this.init.nonce) return }
      else {
        if (typeof p.nonce !== 'string' || !p.nonce || p.nonce.length > 128) return
        // Another document took the view over: the one before it will not answer any more.
        if (p.nonce !== this.init.nonce) { this.failPending('App frame reloaded'); this.dropTransfer() }
        this.init = { ...this.init, nonce: p.nonce }
      }
      // A framed App keeps its nonce across a reload of the same origin: the document id tells the documents apart.
      if (this.transferLink && this.transferLink.documentId !== p.documentId) this.dropTransfer()
      this.ready = true
      this.capabilities = p.appCapabilities.filter((c): c is string => typeof c === 'string')
      this.send('frame.init', this.init)
      if (this.focused !== undefined) this.send('frame.focusChanged', { focused: this.focused })
      if (Object.keys(this.header).length) { this.header = {}; this.callbacks.onHeader?.({}) }
      this.callbacks.onReady?.()
      return
    }
    if (!this.ready) return
    if (m.type === 'transfer.connect') { this.connectTransfer(p, ports); return }
    if (m.type.startsWith('transfer.')) {
      // Over the bridge the link is the channel itself; a framed App must use its port.
      if (!this.framed && this.transferLink) this.receiveTransfer(m, this.transferLink)
      return
    }
    if (m.replyTo) {
      const pending = this.pending.get(m.replyTo)
      if (pending && m.type === pending.type + 'Result') {
        clearTimeout(pending.timer); this.pending.delete(m.replyTo); pending.resolve(m.payload)
      }
      return
    }
    if (m.type === 'window.setTitle' && typeof p.title === 'string') this.callbacks.onTitle?.(p.title.slice(0, 256), p.dirty === true)
    if (m.type === 'window.requestClose') this.callbacks.onRequestClose?.()
    if (m.type === 'header.set') { this.header = { ...this.header, ...readHeader(p) }; this.callbacks.onHeader?.(this.header) }
    if (m.type === 'app.open' && typeof m.id === 'string') void this.appOpen(m.id, p)
    if (m.type === 'sysdlg.open' && typeof m.id === 'string') void this.systemDialog(m.id, p.path, p.params)
    if (m.type === 'content.open' && (p.target === 'default' || p.target === 'preview' || p.target === 'chooser')) {
      const request = { ...(p.request as object), requestId: crypto.randomUUID() }
      if (!isOpenRequest(request) || this.limited('content.open')) return
      this.callbacks.onContentOpen?.(request, p.target, { newWindow: p.newWindow === true, hints: readContentHints(p.hints) })
    }
  }
  update(init: Partial<FrameInit>): void { this.init = { ...this.init, ...init } }
  /** Reports whether the App's window is the focused one; only a change is sent. */
  setFocused(focused: boolean): void {
    if (this.focused === focused) return
    this.focused = focused
    this.send('frame.focusChanged', { focused })
  }
  /** Tells the App what happened in the header the host draws for it. */
  headerEvent(event: HeaderEvent): void { this.send('header.event', event) }
  send(type: string, payload: unknown): void {
    if (this.ready) this.channel.post(envelope(type, payload))
  }
  request(type: string, payload: unknown, timeout = 3000): Promise<unknown> {
    if (!this.ready) return Promise.reject(new Error('App frame is not ready'))
    const id = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('App frame timed out')) }, timeout)
      this.pending.set(id, { resolve, reject, timer, type })
      this.channel.post(envelope(type, payload, { id }))
    })
  }
  async open(request: OpenRequest): Promise<{ accepted: boolean; fallback?: 'preview' }> {
    if (!this.capabilities.includes('open')) return { accepted: false }
    return await this.request('frame.open', { request }) as { accepted: boolean; fallback?: 'preview' }
  }
  async beforeClose(reason: 'user' | 'logout' | 'shell' = 'user'): Promise<CloseDecision> {
    if (!this.ready || !this.capabilities.includes('beforeClose')) return 'allow'
    const r = await this.request('frame.beforeClose', { reason }) as { decision?: CloseDecision }
    return r.decision === 'allow' || r.decision === 'pending' ? r.decision : 'deny'
  }
  async back(): Promise<boolean> {
    if (!this.capabilities.includes('back')) return false
    return (await this.request('frame.back', {}) as { handled?: boolean }).handled === true
  }
  private failPending(reason: string): void {
    this.pending.forEach(p => { clearTimeout(p.timer); p.reject(new Error(reason)) })
    this.pending.clear()
  }
  /** Binds the transfer link of the document that just shook hands: its port (framed) or the bridge. */
  private connectTransfer(p: Record<string, unknown>, ports?: readonly MessagePort[]): void {
    const port = ports?.length === 1 ? ports[0] : undefined
    const refuse = () => ports?.forEach(x => x.close())
    if (!this.init.shellCapabilities.includes(TRANSFER_CAPABILITY) || !this.capabilities.includes(TRANSFER_CAPABILITY)) return refuse()
    if (typeof p.documentId !== 'string' || !DOCUMENT_ID.test(p.documentId) || (this.framed ? !port : !!ports?.length)) return refuse()
    this.dropTransfer()
    const documentId = p.documentId
    let link: TransferLink
    if (port) link = portLink(documentId, port, message => { if (this.transferLink === link) this.receiveTransfer(message, link) })
    else link = { documentId, post: message => this.channel.post(message), close: () => {} }
    this.transferLink = link
    this.callbacks.onTransferConnect?.(documentId)
  }
  /** Drops the transfer link: every request waiting on it fails `stale`, its offers are void. */
  private dropTransfer(): void {
    const link = this.transferLink
    if (!link) return
    this.transferLink = undefined
    link.close()
    this.transferPending.forEach(p => { clearTimeout(p.timer); p.reject(new TransferError('stale', 'The App document changed')) })
    this.transferPending.clear()
    this.callbacks.onTransferDisconnect?.(link.documentId)
  }
  private receiveTransfer(m: unknown, link: TransferLink): void {
    if (!isMessage(m)) return
    const p = m.payload as Record<string, unknown>
    if (m.replyTo) {
      const pending = this.transferPending.get(m.replyTo)
      if (pending && m.type === pending.type + 'Result') { clearTimeout(pending.timer); this.transferPending.delete(m.replyTo); pending.resolve(m.payload) }
      return
    }
    if (m.type === 'transfer.offer' && typeof m.id === 'string') {
      const id = m.id
      const reply = (payload: { ok: true } | { ok: false; code: TransferErrorCode }) => { if (this.transferLink === link) link.post(envelope('transfer.offerResult', payload, { replyTo: id })) }
      const offer = readTransferOffer(p)
      if (!offer) return reply({ ok: false, code: 'unsupported' })
      if (!this.callbacks.onTransferOffer) return reply({ ok: false, code: 'unsupported' })
      void Promise.resolve().then(() => this.callbacks.onTransferOffer!(offer, link.documentId))
        .then(result => reply(result.ok ? { ok: true } : { ok: false, code: transferCode(result.code) }), () => reply({ ok: false, code: 'denied' }))
      return
    }
    if (m.type === 'transfer.cancel' && isTransferId(p.offerId)) this.callbacks.onTransferWithdraw?.(p.offerId, link.documentId)
  }
  private transferRequest(type: string, payload: unknown, timeout: number): Promise<Record<string, unknown>> {
    const link = this.transferLink
    if (!this.ready || !link) return Promise.reject(new TransferError('stale', 'No transfer link'))
    const id = crypto.randomUUID()
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => { this.transferPending.delete(id); reject(new TransferError('timeout')) }, timeout)
      this.transferPending.set(id, { resolve, reject, timer, type })
      link.post(envelope(type, payload, { id }))
    }).then(reply => {
      const r = isObject(reply) ? reply : {}
      if (r.ok !== true) throw new TransferError(transferCode(r.code))
      return r
    })
  }
  /** Asks the App what it would do with these items at a point of its page or at its focus; null when nothing. */
  async transferProbe(probe: TransferProbe, timeout = TRANSFER_TIMEOUT.probe): Promise<TransferProbeAnswer | null> {
    const r = await this.transferRequest('transfer.probe', probe, timeout)
    return r.answer === null ? null : readTransferProbeAnswer(r.answer, probe)
  }
  /** Reads representations of a selection the App offered. Each value is checked by its format. */
  async transferRead(read: TransferReadRequest, timeout = TRANSFER_TIMEOUT.read): Promise<TransferReadValue[]> {
    const r = await this.transferRequest('transfer.read', read, timeout)
    return readTransferReadValues(r.items, read, { files: this.framed })
  }
  /** Hands the chosen representations to the App; a retry with the same `operationId` must not commit twice. */
  async transferDeliver(delivery: TransferDelivery, timeout = TRANSFER_TIMEOUT.deliver): Promise<TransferDeliveryResult> {
    if (!this.framed && delivery.items.some(item => item.format === 'files')) throw new TransferError('unsupported', 'Local files cannot cross the bridge')
    const r = await this.transferRequest('transfer.deliver', delivery, timeout)
    const result = readTransferDeliveryResult(r.result, delivery.items)
    if (!result) throw new TransferError('unsupported', 'Invalid delivery result')
    return result
  }
  /** The final result of a delivery, by its `operationId`; null when the App does not know it. */
  async transferStatus(operationId: string, delivered: Array<{ itemKey: string }>, timeout = TRANSFER_TIMEOUT.status): Promise<TransferDeliveryResult | null> {
    const r = await this.transferRequest('transfer.status', { operationId }, timeout)
    return r.result === null ? null : readTransferDeliveryResult(r.result, delivered) ?? null
  }
  /** Tells the App an operation it took part in was dropped before it committed. */
  transferCancel(operationId: string): void {
    this.transferLink?.post(envelope('transfer.cancel', { operationId }))
  }
  dispose(): void {
    this.detach()
    this.failPending('App frame disposed')
    this.dropTransfer()
    this.ready = false
  }
}
/**
 * Origin of the window embedding this page, when `accept` admits it. `location.ancestorOrigins` names the real
 * parent even after the frame navigated through other pages (a sign-in round trip); the referrer is the fallback.
 * In the BuckyOS client the page is the top document and its host is the client itself, reached over the bridge: the
 * answer is the page's own origin, so that code which connects only when it is embedded connects there too.
 */
/** What an App does as a source and a target of `transfer.v1`. Giving any of these declares the capability. */
export interface AppFrameTransferHandlers {
  /** What this App would do with the items at a point of its page or at its focus; null when it takes none. It must
   * not read, import, change layout or start uploads. */
  onProbe?: (probe: TransferProbe) => TransferProbeAnswer | null | Promise<TransferProbeAnswer | null>
  /** Commits a delivery after checking the place, version and permissions again. The SDK answers a repeated
   * `operationId` with the first result, so this runs once per operation. */
  onDeliver?: (delivery: TransferDelivery) => TransferDeliveryResult | Promise<TransferDeliveryResult>
  /** The representations of a selection this App offered. Throw a `TransferError('stale')` for an older generation. */
  onRead?: (read: TransferReadRequest) => TransferReadValue[] | Promise<TransferReadValue[]>
  /** The Shell dropped an operation before it was committed (the user cancelled, a timeout). */
  onCancel?: (operationId: string) => void
  /** The Shell can (true) or can no longer (false) take offers. */
  onAvailable?: (available: boolean) => void
}
/** The last delivery results an App remembers, to answer a retry or a status query. */
const DELIVERY_MEMORY = 64

export function embedderOrigin(accept: (origin: string) => boolean): string | null {
  if (window.parent === window) return getBuckyApi() && accept(window.location.origin) ? window.location.origin : null
  const candidates = [window.location.ancestorOrigins?.[0], document.referrer]
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      const origin = new URL(candidate).origin
      if (accept(origin)) return origin
    } catch {}
  }
  return null
}
export const originInZone = (origin: string, zoneHost: string): boolean => {
  try {
    const url = new URL(origin)
    return url.protocol === window.location.protocol && (url.hostname === zoneHost || url.hostname.endsWith(`.${zoneHost}`))
  } catch { return false }
}
export class AppFrameClient {
  init?: FrameInit
  private title?: string
  private focused?: boolean
  private helloTimer?: ReturnType<typeof setInterval>
  private helloDeadline?: ReturnType<typeof setTimeout>
  private header: HeaderState = {}
  private readonly nonce: string | null
  /** The page is a top document of the BuckyOS client: its host is reached over the bridge. */
  private readonly native: boolean
  private readonly channel: AppFrameTransport
  private readonly detach: () => void
  private dialogs = new Map<string, { resolve: (result: SelectDialogResult) => void; reject: (error: Error) => void; allowLocal: boolean }>()
  private appOpens = new Map<string, (reply: AppOpenReply) => void>()
  private embedAbort?: AbortController
  /** This document, for `transfer.v1`: a reload of the same frame is another document with the same nonce. */
  private readonly documentId = newOfferId()
  private transferLink?: TransferLink
  private transferPending = new Map<string, { resolve: (v: unknown) => void; timer: ReturnType<typeof setTimeout> }>()
  private deliveries = new Map<string, Promise<TransferDeliveryResult>>()
  private generation = 0
  constructor(private options: {
    shellOrigin: string
    /** The Zone's system entry (its root origin): where content is opened when this page is not embedded in the shell. */
    systemOrigin?: string
    /** This App's id, so the system does not offer the content back to it. */
    appId?: string
    onInit?: (init: FrameInit) => void
    onOpen?: (request: OpenRequest) => Promise<{ accepted: boolean; fallback?: 'preview' }> | { accepted: boolean; fallback?: 'preview' }
    onBeforeClose?: (reason: 'user' | 'logout' | 'shell') => Promise<CloseDecision> | CloseDecision
    onBack?: () => Promise<boolean> | boolean
    onTheme?: (theme: FrameInit['theme']) => void
    onLocale?: (locale: string) => void
    onFocus?: (focused: boolean) => void
    /** The user used the header this App set with `setHeader`. */
    onHeaderEvent?: (event: HeaderEvent) => void
    /** `transfer.v1`: content delivered through the Shell to and from other Apps. */
    transfer?: AppFrameTransferHandlers
  }) {
    const origin = new URL(options.shellOrigin).origin
    const bridge = window.parent === window ? getBuckyApi() : undefined
    this.native = !!bridge
    const name = window.parent !== window ? window.name : ''
    this.nonce = name?.startsWith(FRAME_NAME_PREFIX) ? name.slice(FRAME_NAME_PREFIX.length)
      : new URLSearchParams(window.location.hash.slice(1)).get('bfp') ?? (bridge ? crypto.randomUUID() : null)
    this.channel = bridge ? bridgeTransport(bridge) : windowTransport(() => window.parent, origin)
    this.detach = this.channel.onMessage(message => { void this.receive(message) })
    if ((bridge || window.parent !== window) && this.nonce) {
      const hello = () => this.channel.post(envelope('frame.hello', { nonce: this.nonce, appCapabilities: [
        ...options.onOpen ? ['open'] : [], ...options.onBeforeClose ? ['beforeClose'] : [], ...options.onBack ? ['back'] : [],
        ...options.transfer ? [TRANSFER_CAPABILITY] : [],
      ], ...options.transfer ? { documentId: this.documentId } : {} }))
      hello()
      this.helloTimer = setInterval(hello, 250)
      // A native host may only be set up after the view has loaded.
      this.helloDeadline = setTimeout(() => clearInterval(this.helloTimer), bridge ? 10000 : 1500)
    }
  }
  private async receive(m: unknown): Promise<void> {
    if (!isMessage(m)) return
    const p = m.payload as Record<string, unknown>
    if (m.type === 'frame.init') {
      if (!this.nonce || p.nonce !== this.nonce || typeof p.locale !== 'string' || !p.theme || typeof p.windowId !== 'string' || p.launch && !isOpenRequest(p.launch)) return
      clearInterval(this.helloTimer); clearTimeout(this.helloDeadline)
      this.init = p as unknown as FrameInit
      this.title = undefined; this.focused = undefined
      if (Object.keys(this.header).length) this.send('header.set', this.header)
      this.options.onInit?.(this.init)
      this.connectTransfer()
      return
    }
    if (m.type.startsWith('transfer.')) {
      if (this.native && this.transferLink) void this.receiveTransfer(m, this.transferLink)
      return
    }
    if (!this.init) return
    if (m.type === 'sysdlg.openResult') {
      const pending = m.replyTo ? this.dialogs.get(m.replyTo) : undefined
      if (!pending) return
      this.dialogs.delete(m.replyTo!)
      if (p.ok !== true) return pending.reject(new SystemDialogError(dialogErrorCode(p.code)))
      const result = readSelectDialogResult(p.result, { allowLocal: pending.allowLocal })
      if (result) pending.resolve(result)
      else pending.reject(new SystemDialogError('protocol'))
      return
    }
    if (m.type === 'app.openResult') {
      const code = p.code === 'not_found' || p.code === 'denied' ? p.code : 'unsupported'
      if (m.replyTo) this.appOpens.get(m.replyTo)?.(p.ok === true ? { ok: true } : { ok: false, code })
      return
    }
    if (m.type === 'header.event') {
      if (p.kind !== 'search' && p.kind !== 'item' && p.kind !== 'menu') return
      this.options.onHeaderEvent?.({ kind: p.kind, ...(typeof p.id === 'string' ? { id: p.id } : {}), ...(typeof p.value === 'string' ? { value: p.value } : {}) })
      return
    }
    const reply = (payload: unknown) => this.channel.post(envelope(m.type + 'Result', payload, { replyTo: m.id }))
    try {
      if (m.type === 'frame.open' && isOpenRequest(p.request)) reply(await this.options.onOpen?.(p.request) ?? { accepted: false })
      if (m.type === 'frame.beforeClose') reply({ decision: await this.options.onBeforeClose?.(p.reason as 'user') ?? 'allow' })
      if (m.type === 'frame.back') reply({ handled: await this.options.onBack?.() ?? false })
      if (m.type === 'frame.themeChanged' && (p.mode === 'dark' || p.mode === 'light')) this.options.onTheme?.(p as FrameInit['theme'])
      if (m.type === 'frame.localeChanged' && typeof p.locale === 'string') this.options.onLocale?.(p.locale)
      if (m.type === 'frame.focusChanged' && this.focused !== (p.focused === true)) { this.focused = p.focused === true; this.options.onFocus?.(this.focused) }
    } catch {
      if (m.type === 'frame.open') reply({ accepted: false, fallback: 'preview' })
      if (m.type === 'frame.beforeClose') reply({ decision: 'deny' })
    }
  }
  send(type: string, payload: unknown): void {
    if (this.init) this.channel.post(envelope(type, payload))
  }
  setTitle(title: string, dirty = false): void {
    const key = JSON.stringify([title, dirty])
    if (!this.init || key === this.title) return
    this.title = key
    this.send('window.setTitle', { title, dirty })
  }
  requestClose(): void { this.send('window.requestClose', {}) }
  /** Sets what the host shows in the header above this App. It may be called before the handshake. */
  setHeader(header: HeaderState): void {
    this.header = { ...this.header, ...header }
    this.send('header.set', header)
  }
  /**
   * Opens another App, or a page of one, in this App's Zone (or in `zone`). The host decides between a new window and
   * an open one. In a standalone tab it opens the Zone's system entry (`systemOrigin`) in a new tab, which only reaches
   * this App's own Zone. Never rejects.
   */
  openApp(request: AppOpenRequest): Promise<AppOpenReply> {
    const clean = readAppOpenRequest(request)
    if (!clean) return Promise.resolve({ ok: false, code: 'denied' })
    if (this.init) {
      if (!this.init.shellCapabilities.includes('app.open')) return Promise.resolve({ ok: false, code: 'unsupported' })
      const id = crypto.randomUUID()
      return new Promise(resolve => {
        const settle = (reply: AppOpenReply) => { clearTimeout(timer); this.appOpens.delete(id); resolve(reply) }
        const timer = setTimeout(() => settle({ ok: false, code: 'unsupported' }), 30000)
        this.appOpens.set(id, settle)
        this.channel.post(envelope('app.open', clean, { id }))
      })
    }
    if (!this.options.systemOrigin || clean.zone) return Promise.resolve({ ok: false, code: 'unsupported' })
    window.open(systemOpenAppUrl(this.options.systemOrigin, clean), '_blank', 'noopener')
    return Promise.resolve({ ok: true })
  }
  /**
   * Asks the system to open content: with its default app, in Preview, or by letting the user choose (`chooser`).
   * Inside the shell or the BuckyOS client the request goes to the host; in a standalone tab it opens the Zone's system
   * entry (`systemOrigin`) in a new tab. Returns false when neither is available.
   */
  openContent(request: Omit<OpenRequest, 'requestId'>, target: ContentOpenTarget = 'default', options: { newWindow?: boolean; hints?: ContentHints } = {}): boolean {
    const hints = options.hints ?? {}
    if (this.init) { this.send('content.open', { request, target, newWindow: options.newWindow === true, hints }); return true }
    if (!this.options.systemOrigin) return false
    window.open(systemOpenUrl(this.options.systemOrigin, { request, target, hints, from: this.options.appId }), '_blank', 'noopener')
    return true
  }
  /**
   * Shows the system file picker (`sysdlg/select`) and resolves with what the user chose; cancelling resolves with
   * `{ action: 'cancelled' }`. Embedded in the shell the shell draws the dialog over this App's window; in a
   * standalone tab, and in the BuckyOS client unless it lists the dialog, the picker page of the Zone's system entry
   * (`systemOrigin`) is framed over this page. Rejects with a `SystemDialogError` when no picker is available or the
   * request did not complete.
   */
  selectContent(params: SelectDialogParams = {}, options: { signal?: AbortSignal; theme?: 'light' | 'dark'; locale?: string } = {}): Promise<SelectDialogResult> {
    const offered = this.init?.shellCapabilities.includes(SELECT_DIALOG_PATH)
    if (this.init && (offered || !this.native)) {
      if (!offered) return Promise.reject(new SystemDialogError('unsupported'))
      if (this.dialogs.size) return Promise.reject(new SystemDialogError('busy'))
      const id = crypto.randomUUID()
      return new Promise((resolve, reject) => {
        this.dialogs.set(id, { resolve, reject, allowLocal: params.allowLocal === true })
        this.channel.post(envelope('sysdlg.open', { path: SELECT_DIALOG_PATH, params }, { id }))
      })
    }
    if (!this.options.systemOrigin) return Promise.reject(new SystemDialogError('unsupported'))
    const abort = this.embedAbort = new AbortController()
    options.signal?.addEventListener('abort', () => abort.abort(), { once: true })
    if (options.signal?.aborted) abort.abort()
    return openSelectEmbed(this.options.systemOrigin, params, { ...options, signal: abort.signal })
  }
  /** Whether the Shell takes offers from this document (`transfer.v1` on both sides, link connected). */
  get transferAvailable(): boolean { return !!this.transferLink }
  /** Once per document, after the first `frame.init` that lists `transfer.v1`: one port, to the exact Shell origin. */
  private connectTransfer(): void {
    if (!this.options.transfer || this.transferLink || !this.init?.shellCapabilities.includes(TRANSFER_CAPABILITY)) return
    let link: TransferLink
    if (this.native) {
      link = { documentId: this.documentId, post: message => this.channel.post(message), close: () => {} }
      this.channel.post(envelope('transfer.connect', { documentId: this.documentId }))
    } else {
      const channel = new MessageChannel()
      link = portLink(this.documentId, channel.port1, message => { void this.receiveTransfer(message, link) })
      this.channel.post(envelope('transfer.connect', { documentId: this.documentId }), [channel.port2])
    }
    this.transferLink = link
    try { this.options.transfer.onAvailable?.(true) } catch { /* the App's own handler */ }
  }
  private async receiveTransfer(m: unknown, link: TransferLink): Promise<void> {
    if (!isMessage(m) || this.transferLink !== link) return
    const p = m.payload as Record<string, unknown>
    if (m.replyTo) {
      const pending = this.transferPending.get(m.replyTo)
      if (pending && m.type === 'transfer.offerResult') { clearTimeout(pending.timer); this.transferPending.delete(m.replyTo); pending.resolve(m.payload) }
      return
    }
    const handlers = this.options.transfer ?? {}
    if (m.type === 'transfer.cancel') { if (isTransferId(p.operationId)) handlers.onCancel?.(p.operationId); return }
    if (typeof m.id !== 'string') return
    const reply = (payload: unknown) => { if (this.transferLink === link) link.post(envelope(m.type + 'Result', payload, { replyTo: m.id })) }
    const fail = (error: unknown) => reply({ ok: false, code: error instanceof TransferError && error.code !== 'timeout' ? error.code : 'denied' })
    try {
      if (m.type === 'transfer.probe') {
        const probe = readTransferProbe(p)
        if (!probe || !handlers.onProbe) return reply({ ok: false, code: 'unsupported' })
        const answer = await handlers.onProbe(probe)
        return reply({ ok: true, answer: answer ? readTransferProbeAnswer(answer, probe) : null })
      }
      if (m.type === 'transfer.read') {
        const read = readTransferReadRequest(p)
        if (!read || !handlers.onRead) return reply({ ok: false, code: 'unsupported' })
        // Over the bridge a `File` cannot cross: the Shell is told this representation is not available.
        return reply({ ok: true, items: readTransferReadValues(await handlers.onRead(read), read, { files: !this.native }) })
      }
      if (m.type === 'transfer.deliver') {
        const delivery = readTransferDelivery(p)
        if (!delivery || !handlers.onDeliver) return reply({ ok: false, code: 'unsupported' })
        let result = this.deliveries.get(delivery.operationId)
        if (!result) {
          const onDeliver = handlers.onDeliver
          result = Promise.resolve().then(() => onDeliver(delivery))
          this.deliveries.set(delivery.operationId, result)
          // A failed attempt may be retried: only results are remembered.
          result.catch(() => this.deliveries.delete(delivery.operationId))
          for (const key of [...this.deliveries.keys()].slice(0, Math.max(0, this.deliveries.size - DELIVERY_MEMORY))) this.deliveries.delete(key)
        }
        return reply({ ok: true, result: readTransferDeliveryResult(await result, delivery.items) })
      }
      if (m.type === 'transfer.status') {
        if (!isTransferId(p.operationId)) return reply({ ok: false, code: 'unsupported' })
        const result = this.deliveries.get(p.operationId)
        return reply({ ok: true, result: result ? await result : null })
      }
      reply({ ok: false, code: 'unsupported' })
    } catch (error) { fail(error) }
  }
  /**
   * Registers a selection with the Shell so another App can receive it (the Shell's drag handle, "Paste desktop
   * object…"). The offer id is generated here; withdraw it when the selection goes away. Never rejects.
   */
  offerTransfer(offer: { purpose: TransferOfferPurpose; items: TransferOfferItem[]; scope?: Record<string, string>; generation?: number }): Promise<{ ok: true; offerId: string } | { ok: false; code: TransferErrorCode }> {
    const link = this.transferLink
    if (!link) return Promise.resolve({ ok: false, code: 'unsupported' })
    const message = readTransferOffer({ ...offer, offerId: newOfferId(), generation: offer.generation ?? ++this.generation })
    if (!message) return Promise.resolve({ ok: false, code: 'unsupported' })
    const id = crypto.randomUUID()
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.transferPending.delete(id); resolve({ ok: false, code: 'unsupported' }) }, TRANSFER_TIMEOUT.offer)
      this.transferPending.set(id, { timer, resolve: reply => {
        const r = isObject(reply) ? reply : {}
        resolve(r.ok === true ? { ok: true, offerId: message.offerId } : { ok: false, code: transferCode(r.code) })
      } })
      link.post(envelope('transfer.offer', message, { id }))
    })
  }
  /** Withdraws a selection offered with `offerTransfer`. */
  withdrawTransfer(offerId: string): void {
    if (isTransferId(offerId)) this.transferLink?.post(envelope('transfer.cancel', { offerId }))
  }
  dispose(): void {
    clearInterval(this.helloTimer); clearTimeout(this.helloDeadline); this.detach()
    this.transferLink?.close(); this.transferLink = undefined
    this.transferPending.forEach(p => { clearTimeout(p.timer); p.resolve({ ok: false, code: 'stale' }) }); this.transferPending.clear()
    this.appOpens.forEach(settle => settle({ ok: false, code: 'unsupported' }))
    this.dialogs.forEach(pending => pending.reject(new SystemDialogError('closed')))
    this.dialogs.clear(); this.embedAbort?.abort()
  }
}

/**
 * Preview embed protocol (`buckyos.preview-embed` v1): an App shows the system Preview component inside its own UI.
 * The App frames `<systemOrigin>/embed/preview` (component only, no shell) and hands it a content reference; the
 * system page reads the content with its own Zone-root session, so no token crosses origins. Open With goes back
 * through the App to the shell (`AppFrameClient.openContent(…, 'chooser')`).
 */
export type PreviewEmbedSource = TransferableContentRef | { kind: 'blob'; blob: Blob; name: string }
export interface PreviewEmbedInit {
  nonce: string
  source: PreviewEmbedSource
  session?: TransferableSessionContext
  theme: 'light' | 'dark'
  locale: string
}
export interface PreviewEmbedState {
  status: 'loading' | 'ready' | 'error'
  /** Preview error kind (`unsupported`, `not-found`, `permission-denied`, `timeout`, `error`, …) and code. */
  error?: { kind: string; code: string }
  title?: string
  mediaType?: string
}
export interface PreviewEmbedOpenWith { request: Omit<OpenRequest, 'requestId'>; hints: ContentHints }
const PREVIEW_EMBED = 'buckyos.preview-embed'
const embedEnvelope = (type: string, payload: unknown, protocol = PREVIEW_EMBED) => ({ protocol, version: 1, type, payload })
const isEmbedMessage = (value: unknown, protocol = PREVIEW_EMBED): value is { type: string; payload: Record<string, unknown> } => {
  const v = value as { protocol?: unknown; version?: unknown; type?: unknown; payload?: unknown } | null
  return !!v && v.protocol === protocol && v.version === 1 && typeof v.type === 'string' && !!v.payload && typeof v.payload === 'object'
}
const isEmbedSource = (value: unknown): value is PreviewEmbedSource =>
  isTransferableRef(value) || (!!value && typeof value === 'object' && (value as { kind?: unknown }).kind === 'blob' &&
    typeof Blob !== 'undefined' && (value as { blob?: unknown }).blob instanceof Blob && typeof (value as { name?: unknown }).name === 'string')
export const PREVIEW_EMBED_PATH = '/embed/preview'

/** App side: owns the iframe that shows the system Preview. */
export class PreviewEmbed {
  readonly url: string
  private readonly nonce = crypto.randomUUID()
  private readonly origin: string
  private readonly listener = (event: MessageEvent) => this.receive(event)
  private init: Omit<PreviewEmbedInit, 'nonce'>
  private ready = false
  constructor(private options: {
    systemOrigin: string
    frame: () => HTMLIFrameElement | null
    init: Omit<PreviewEmbedInit, 'nonce'>
    onState?: (state: PreviewEmbedState) => void
    onOpenWith?: (open: PreviewEmbedOpenWith) => void
    onExit?: () => void
  }) {
    this.origin = new URL(options.systemOrigin).origin
    this.init = options.init
    this.url = `${this.origin}${PREVIEW_EMBED_PATH}#bpe=${this.nonce}&po=${encodeURIComponent(window.location.origin)}`
    window.addEventListener('message', this.listener)
  }
  private post(type: string, payload: unknown): void {
    this.options.frame()?.contentWindow?.postMessage(embedEnvelope(type, payload), this.origin)
  }
  private receive(event: MessageEvent): void {
    if (event.origin !== this.origin || event.source !== this.options.frame()?.contentWindow || !isEmbedMessage(event.data)) return
    const { type, payload: p } = event.data
    if (type === 'embed.hello') { if (p.nonce === this.nonce) { this.ready = true; this.post('embed.init', { ...this.init, nonce: this.nonce }) } return }
    if (type === 'embed.state' && (p.status === 'loading' || p.status === 'ready' || p.status === 'error')) {
      const error = p.error as { kind?: unknown; code?: unknown } | undefined
      this.options.onState?.({ status: p.status,
        error: error && typeof error.kind === 'string' && typeof error.code === 'string' ? { kind: error.kind, code: error.code } : undefined,
        title: typeof p.title === 'string' ? p.title.slice(0, 256) : undefined, mediaType: typeof p.mediaType === 'string' ? p.mediaType.slice(0, 128) : undefined })
    }
    if (type === 'embed.openWith') {
      const request = p.request as Omit<OpenRequest, 'requestId'> | undefined
      if (request && isTransferableRef(request.source) && (request.session === undefined || isTransferableSession(request.session))) {
        this.options.onOpenWith?.({ request: { source: request.source, session: request.session }, hints: readContentHints(p.hints) })
      }
    }
    if (type === 'embed.exit') this.options.onExit?.()
  }
  update(patch: Partial<Pick<PreviewEmbedInit, 'theme' | 'locale'>>): void {
    this.init = { ...this.init, ...patch }
    // Before the handshake the frame still holds its initial about:blank (this App's origin, so the browser rejects
    // the target origin); `embed.init` carries the patch.
    if (this.ready) this.post('embed.update', patch)
  }
  dispose(): void { window.removeEventListener('message', this.listener) }
}

/** System side: the component-only page at `PREVIEW_EMBED_PATH`. Accepts one embedding App whose origin `accept` admits. */
export class PreviewEmbedHost {
  readonly parentOrigin: string | null
  private readonly nonce: string | null
  private ready = false
  private readonly hello?: ReturnType<typeof setInterval>
  private readonly listener = (event: MessageEvent) => this.receive(event)
  constructor(private options: {
    accept: (origin: string) => boolean
    onInit: (init: PreviewEmbedInit) => void
    onUpdate?: (patch: Partial<Pick<PreviewEmbedInit, 'theme' | 'locale'>>) => void
  }) {
    const params = new URLSearchParams(window.location.hash.slice(1))
    this.nonce = params.get('bpe')
    let parentOrigin: string | null = null
    try { parentOrigin = new URL(params.get('po') ?? '').origin } catch {}
    this.parentOrigin = window.parent !== window && this.nonce && parentOrigin && options.accept(parentOrigin) ? parentOrigin : null
    if (!this.parentOrigin) return
    window.addEventListener('message', this.listener)
    const hello = () => window.parent.postMessage(embedEnvelope('embed.hello', { nonce: this.nonce }), this.parentOrigin!)
    hello()
    this.hello = setInterval(() => { if (!this.ready) hello() }, 250)
  }
  private receive(event: MessageEvent): void {
    if (event.source !== window.parent || event.origin !== this.parentOrigin || !isEmbedMessage(event.data)) return
    const { type, payload: p } = event.data
    if (type === 'embed.init') {
      if (p.nonce !== this.nonce || !isEmbedSource(p.source) || (p.session !== undefined && !isTransferableSession(p.session)) || typeof p.locale !== 'string') return
      this.ready = true; clearInterval(this.hello)
      this.options.onInit({ nonce: String(p.nonce), source: p.source, session: p.session as TransferableSessionContext | undefined, theme: p.theme === 'dark' ? 'dark' : 'light', locale: p.locale })
      return
    }
    if (type === 'embed.update' && this.ready) {
      const patch: Partial<Pick<PreviewEmbedInit, 'theme' | 'locale'>> = {}
      if (p.theme === 'dark' || p.theme === 'light') patch.theme = p.theme
      if (typeof p.locale === 'string') patch.locale = p.locale
      this.options.onUpdate?.(patch)
    }
  }
  private post(type: string, payload: unknown): void {
    if (this.ready && this.parentOrigin) window.parent.postMessage(embedEnvelope(type, payload), this.parentOrigin)
  }
  state(state: PreviewEmbedState): void { this.post('embed.state', state) }
  openWith(open: PreviewEmbedOpenWith): void { this.post('embed.openWith', open) }
  exit(): void { this.post('embed.exit', {}) }
  dispose(): void { clearInterval(this.hello); window.removeEventListener('message', this.listener) }
}

/**
 * System dialog embed protocol (`buckyos.sysdlg-embed` v1): a standalone App page (no shell) shows the system file
 * picker by framing `<systemOrigin>/embed/sysdlg/select` over itself. The handshake is the Preview embed's
 * (`embed.hello` → `embed.init`); the system page browses with its own Zone-root session and answers with
 * `embed.result`. No token crosses origins, and every message names its exact target origin.
 */
const SYSDLG_EMBED = 'buckyos.sysdlg-embed'
export const SELECT_EMBED_PATH = '/embed/sysdlg/select'
export interface SelectEmbedInit { nonce: string; params: unknown; theme: 'light' | 'dark'; locale: string }
let selectEmbedOpen = false

/** App side of `buckyos.sysdlg-embed`: the full-page layer that frames the picker. One at a time per page. */
export function openSelectEmbed(systemOrigin: string, params: SelectDialogParams, options: { signal?: AbortSignal; theme?: 'light' | 'dark'; locale?: string } = {}): Promise<SelectDialogResult> {
  if (options.signal?.aborted) return Promise.reject(new SystemDialogError('closed'))
  if (selectEmbedOpen) return Promise.reject(new SystemDialogError('busy'))
  selectEmbedOpen = true
  const origin = new URL(systemOrigin).origin
  const locale = options.locale ?? navigator.language ?? 'en'
  const theme = options.theme ?? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  const zh = locale.toLowerCase().startsWith('zh')
  return new Promise((resolve, reject) => {
    const body = document.body
    const html = document.documentElement
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const scroll = { x: window.scrollX, y: window.scrollY }
    const saved = { body: body.getAttribute('style'), html: html.getAttribute('style') }
    const siblings = Array.from(body.children).filter((el): el is HTMLElement => el instanceof HTMLElement)
      .map(el => ({ el, inert: el.inert, hidden: el.getAttribute('aria-hidden') }))
    const root = document.createElement('div')
    root.setAttribute('data-buckyos-sysdlg', 'select')
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true')
    root.setAttribute('aria-label', zh ? '文件选择器' : 'File picker')
    root.style.cssText = 'position:fixed;inset:0;height:100vh;height:100dvh;z-index:2147483647;background:rgba(0,0,0,.32);display:flex;align-items:center;justify-content:center'
    let frame: HTMLIFrameElement | undefined
    let nonce = ''
    let timer: ReturnType<typeof setTimeout> | undefined
    let done = false
    const block = (event: Event) => { if (!root.contains(event.target as Node)) { event.stopPropagation(); event.preventDefault() } }
    const blocked = ['keydown', 'pointerdown', 'mousedown', 'touchstart', 'wheel'] as const
    const cleanup = () => {
      if (done) return false
      done = true; selectEmbedOpen = false
      clearTimeout(timer)
      window.removeEventListener('message', receive)
      options.signal?.removeEventListener('abort', abort)
      if (!('inert' in HTMLElement.prototype)) blocked.forEach(type => document.removeEventListener(type, block, true))
      root.remove()
      siblings.forEach(({ el, inert, hidden }) => { el.inert = inert; if (hidden === null) el.removeAttribute('aria-hidden'); else el.setAttribute('aria-hidden', hidden) })
      if (saved.body === null) body.removeAttribute('style'); else body.setAttribute('style', saved.body)
      if (saved.html === null) html.removeAttribute('style'); else html.setAttribute('style', saved.html)
      window.scrollTo(scroll.x, scroll.y)
      focused?.focus({ preventScroll: true })
      return true
    }
    const finish = (result: SelectDialogResult) => { if (cleanup()) resolve(result) }
    const fail = (code: SystemDialogErrorCode) => { if (cleanup()) reject(new SystemDialogError(code)) }
    const abort = () => fail('closed')
    const showFailure = () => {
      frame?.remove(); frame = undefined
      const panel = document.createElement('div')
      panel.setAttribute('role', 'alert')
      panel.style.cssText = `max-width:22rem;margin:1rem;padding:1.25rem;border-radius:16px;font:14px/1.6 system-ui,sans-serif;background:${theme === 'dark' ? '#1f2329' : '#fff'};color:${theme === 'dark' ? '#f2f3f5' : '#1f2329'};box-shadow:0 24px 64px rgba(0,0,0,.24)`
      const text = document.createElement('p')
      text.style.margin = '0 0 1rem'
      text.textContent = zh ? '无法加载文件选择器' : 'Unable to load the file picker'
      const actions = document.createElement('div')
      actions.style.cssText = 'display:flex;gap:.5rem;justify-content:flex-end'
      const button = (label: string, action: () => void) => {
        const el = document.createElement('button')
        el.type = 'button'; el.textContent = label
        el.style.cssText = 'min-height:2.25rem;padding:0 1rem;font:inherit;border-radius:999px;border:1px solid currentColor;background:transparent;color:inherit;cursor:pointer'
        el.addEventListener('click', action); actions.append(el); return el
      }
      button(zh ? '取消' : 'Cancel', () => fail('load_failed'))
      const retry = button(zh ? '重试' : 'Retry', () => { panel.remove(); load() })
      panel.append(text, actions); root.append(panel); retry.focus()
    }
    const load = () => {
      nonce = crypto.randomUUID()
      frame = document.createElement('iframe')
      frame.title = zh ? '文件选择器' : 'File picker'
      frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent;color-scheme:normal'
      frame.setAttribute('allowtransparency', 'true')
      frame.addEventListener('error', showFailure)
      frame.src = `${origin}${SELECT_EMBED_PATH}#bse=${nonce}&po=${encodeURIComponent(window.location.origin)}`
      root.append(frame)
      timer = setTimeout(showFailure, 10000)
    }
    const receive = (event: MessageEvent) => {
      if (!frame || event.origin !== origin || event.source !== frame.contentWindow || !isEmbedMessage(event.data, SYSDLG_EMBED)) return
      const { type, payload: p } = event.data
      if (type === 'embed.hello') {
        if (p.nonce !== nonce) return
        clearTimeout(timer)
        frame.contentWindow?.postMessage(embedEnvelope('embed.init', { nonce, params, theme, locale } satisfies SelectEmbedInit, SYSDLG_EMBED), origin)
        frame.focus()
      }
      if (type === 'embed.error') fail(dialogErrorCode(p.code))
      if (type === 'embed.result') {
        const result = readSelectDialogResult(p.result, { allowLocal: params.allowLocal === true })
        if (result) finish(result)
        else fail('protocol')
      }
    }
    window.addEventListener('message', receive)
    options.signal?.addEventListener('abort', abort, { once: true })
    if ('inert' in HTMLElement.prototype) siblings.forEach(({ el }) => { el.inert = true })
    else { siblings.forEach(({ el }) => el.setAttribute('aria-hidden', 'true')); blocked.forEach(type => document.addEventListener(type, block, true)) }
    // `overflow: hidden` alone does not stop the page behind from scrolling on iOS; pinning the body does.
    html.style.overflow = 'hidden'
    body.style.position = 'fixed'; body.style.top = `${-scroll.y}px`; body.style.left = `${-scroll.x}px`; body.style.right = '0'; body.style.overflow = 'hidden'
    body.append(root)
    load()
  })
}

/** System side: the picker page at `SELECT_EMBED_PATH`. Works only for an embedding page whose origin `accept` admits. */
export class SelectEmbedHost {
  readonly parentOrigin: string | null
  private readonly nonce: string | null
  private ready = false
  private readonly hello?: ReturnType<typeof setInterval>
  private readonly listener = (event: MessageEvent) => this.receive(event)
  constructor(private options: { accept: (origin: string) => boolean; onInit: (init: SelectEmbedInit) => void }) {
    const params = new URLSearchParams(window.location.hash.slice(1))
    this.nonce = params.get('bse')
    let parentOrigin: string | null = null
    try { parentOrigin = new URL(params.get('po') ?? '').origin } catch {}
    this.parentOrigin = window.parent !== window && this.nonce && parentOrigin && options.accept(parentOrigin) ? parentOrigin : null
    if (!this.parentOrigin) return
    window.addEventListener('message', this.listener)
    const hello = () => window.parent.postMessage(embedEnvelope('embed.hello', { nonce: this.nonce }, SYSDLG_EMBED), this.parentOrigin!)
    hello()
    this.hello = setInterval(() => { if (!this.ready) hello() }, 250)
  }
  private receive(event: MessageEvent): void {
    if (event.source !== window.parent || event.origin !== this.parentOrigin || !isEmbedMessage(event.data, SYSDLG_EMBED)) return
    const { type, payload: p } = event.data
    if (type !== 'embed.init' || this.ready || p.nonce !== this.nonce || typeof p.locale !== 'string') return
    this.ready = true; clearInterval(this.hello)
    this.options.onInit({ nonce: String(p.nonce), params: p.params, theme: p.theme === 'dark' ? 'dark' : 'light', locale: p.locale })
  }
  private post(type: string, payload: unknown): void {
    if (this.ready && this.parentOrigin) window.parent.postMessage(embedEnvelope(type, payload, SYSDLG_EMBED), this.parentOrigin)
  }
  result(result: SelectDialogResult): void { this.post('embed.result', { result }) }
  error(code: SystemDialogErrorCode): void { this.post('embed.error', { code }) }
  dispose(): void { clearInterval(this.hello); window.removeEventListener('message', this.listener) }
}

/**
 * Conversation embed protocol (`buckyos.conversation-embed` v1): an App shows a conversation of the user with an
 * Agent inside its own layout, rendered by the system conversation component. The App frames
 * `<systemOrigin>/embed/conversation` (component only, no shell); the handshake is the Preview embed's
 * (`embed.hello` → `embed.init`). The system page works with its own Zone-root session and derives the App from the
 * embedder's origin, never from anything the App says: no token crosses origins, and message contents never travel
 * back to the App (it reads them with its own session if it needs them).
 */
const CONVERSATION_EMBED = 'buckyos.conversation-embed'
export const CONVERSATION_EMBED_PATH = '/embed/conversation'
/**
 * `agent`: the conversation with this Agent (the owner's default Agent when `agentDid` is left out) that this App
 * started; without one, the first message starts it. With a `memoryMode`, only a conversation in that mode counts, and
 * the one the first message starts has it (`normal` when left out). `session`: an existing conversation, when the
 * system allows this App to open it.
 */
export type ConversationEmbedTarget = { kind: 'agent'; agentDid?: string; memoryMode?: ConversationMemoryMode } | { kind: 'session'; sessionId: string }
/**
 * Whether what is said in a conversation with an Agent, and what the work it starts finds, reaches the Agent's
 * long-term memory (`no_write`: it does not), and whether that memory reaches the conversation (`no_read_write`:
 * neither way).
 */
export type ConversationMemoryMode = 'normal' | 'no_write' | 'no_read_write'
export interface ConversationEmbedInit {
  nonce: string
  target: ConversationEmbedTarget
  theme: 'light' | 'dark'
  locale: string
  /** The composer's placeholder. */
  placeholder?: string
}
/** What the system page receives: `target` is untrusted input it validates itself. */
export type ConversationEmbedHostInit = Omit<ConversationEmbedInit, 'target'> & { target: unknown }
/** A message the App sends in the user's name; `attachments` are content the user can read in the Zone. */
export interface ConversationEmbedSend { text: string; attachments?: TransferableContentRef[] }
export interface ConversationEmbedState {
  status: 'loading' | 'ready' | 'error'
  /** The conversation shown, once there is one. */
  sessionId?: string
  error?: string
}
/**
 * What the conversation in front is doing: `idle`; `running` while the Agent handles the message in front,
 * `interrupted` after a restart in the middle of it, `paused`; `answer` while a question of the Agent waits for the
 * user's answer.
 */
export type ConversationEmbedTurnMode = 'idle' | 'running' | 'interrupted' | 'paused' | 'answer'
export const CONVERSATION_EMBED_ERROR_CODES = ['invalid_params', 'not_found', 'denied'] as const
export type ConversationEmbedErrorCode = typeof CONVERSATION_EMBED_ERROR_CODES[number]
const TURN_MODES: readonly ConversationEmbedTurnMode[] = ['idle', 'running', 'interrupted', 'paused', 'answer']
const MAX_EMBED_TEXT = 64 * 1024
const MAX_EMBED_ATTACHMENTS = 32
const readEmbedSend = (p: Record<string, unknown>): ConversationEmbedSend | null => {
  if (typeof p.text !== 'string' || p.text.length > MAX_EMBED_TEXT) return null
  if (p.attachments === undefined) return { text: p.text }
  if (!Array.isArray(p.attachments) || p.attachments.length > MAX_EMBED_ATTACHMENTS || !p.attachments.every(isTransferableRef)) return null
  return { text: p.text, attachments: p.attachments as TransferableContentRef[] }
}

/** App side: owns the iframe that shows the system conversation. */
export class ConversationEmbed {
  readonly url: string
  private readonly nonce = crypto.randomUUID()
  private readonly origin: string
  private readonly listener = (event: MessageEvent) => this.receive(event)
  private init: Omit<ConversationEmbedInit, 'nonce'>
  private ready = false
  private outbox: ConversationEmbedSend[] = []
  constructor(private options: {
    systemOrigin: string
    frame: () => HTMLIFrameElement | null
    init: Omit<ConversationEmbedInit, 'nonce'>
    onState?: (state: ConversationEmbedState) => void
    onTurn?: (mode: ConversationEmbedTurnMode) => void
    onError?: (code: ConversationEmbedErrorCode) => void
  }) {
    this.origin = new URL(options.systemOrigin).origin
    this.init = options.init
    this.url = `${this.origin}${CONVERSATION_EMBED_PATH}#bce=${this.nonce}&po=${encodeURIComponent(window.location.origin)}`
    window.addEventListener('message', this.listener)
  }
  private post(type: string, payload: unknown): void {
    this.options.frame()?.contentWindow?.postMessage(embedEnvelope(type, payload, CONVERSATION_EMBED), this.origin)
  }
  private receive(event: MessageEvent): void {
    if (event.origin !== this.origin || event.source !== this.options.frame()?.contentWindow || !isEmbedMessage(event.data, CONVERSATION_EMBED)) return
    const { type, payload: p } = event.data
    if (type === 'embed.hello') {
      if (p.nonce !== this.nonce) return
      this.ready = true
      this.post('embed.init', { ...this.init, nonce: this.nonce })
      const queued = this.outbox
      this.outbox = []
      queued.forEach(message => this.post('embed.send', message))
      return
    }
    if (type === 'embed.state' && (p.status === 'loading' || p.status === 'ready' || p.status === 'error')) {
      this.options.onState?.({ status: p.status,
        sessionId: typeof p.sessionId === 'string' ? p.sessionId.slice(0, 512) : undefined,
        error: typeof p.error === 'string' ? p.error.slice(0, 128) : undefined })
    }
    if (type === 'embed.turn' && TURN_MODES.includes(p.mode as ConversationEmbedTurnMode)) this.options.onTurn?.(p.mode as ConversationEmbedTurnMode)
    if (type === 'embed.error' && CONVERSATION_EMBED_ERROR_CODES.includes(p.code as ConversationEmbedErrorCode)) this.options.onError?.(p.code as ConversationEmbedErrorCode)
  }
  update(patch: Partial<Pick<ConversationEmbedInit, 'theme' | 'locale'>>): void {
    this.init = { ...this.init, ...patch }
    if (this.ready) this.post('embed.update', patch)
  }
  /** Sends a message in the user's name. Before the handshake it waits and goes out right after `embed.init`. */
  send(message: ConversationEmbedSend): void {
    const payload: ConversationEmbedSend = { text: message.text, ...(message.attachments?.length ? { attachments: message.attachments } : {}) }
    if (this.ready) this.post('embed.send', payload)
    else this.outbox.push(payload)
  }
  dispose(): void { window.removeEventListener('message', this.listener); this.outbox = [] }
}

/** System side: the component-only page at `CONVERSATION_EMBED_PATH`. Accepts one embedding App whose origin `accept` admits. */
export class ConversationEmbedHost {
  readonly parentOrigin: string | null
  private readonly nonce: string | null
  private ready = false
  private readonly hello?: ReturnType<typeof setInterval>
  private readonly listener = (event: MessageEvent) => this.receive(event)
  constructor(private options: {
    accept: (origin: string) => boolean
    onInit: (init: ConversationEmbedHostInit) => void
    onUpdate?: (patch: Partial<Pick<ConversationEmbedInit, 'theme' | 'locale'>>) => void
    onSend?: (message: ConversationEmbedSend) => void
  }) {
    const params = new URLSearchParams(window.location.hash.slice(1))
    this.nonce = params.get('bce')
    let parentOrigin: string | null = null
    try { parentOrigin = new URL(params.get('po') ?? '').origin } catch {}
    this.parentOrigin = window.parent !== window && this.nonce && parentOrigin && options.accept(parentOrigin) ? parentOrigin : null
    if (!this.parentOrigin) return
    window.addEventListener('message', this.listener)
    const hello = () => window.parent.postMessage(embedEnvelope('embed.hello', { nonce: this.nonce }, CONVERSATION_EMBED), this.parentOrigin!)
    hello()
    this.hello = setInterval(() => { if (!this.ready) hello() }, 250)
  }
  private receive(event: MessageEvent): void {
    if (event.source !== window.parent || event.origin !== this.parentOrigin || !isEmbedMessage(event.data, CONVERSATION_EMBED)) return
    const { type, payload: p } = event.data
    if (type === 'embed.init') {
      if (this.ready || p.nonce !== this.nonce || typeof p.locale !== 'string') return
      this.ready = true; clearInterval(this.hello)
      this.options.onInit({ nonce: String(p.nonce), target: p.target, theme: p.theme === 'dark' ? 'dark' : 'light', locale: p.locale,
        ...(typeof p.placeholder === 'string' ? { placeholder: p.placeholder.slice(0, 200) } : {}) })
      return
    }
    if (!this.ready) return
    if (type === 'embed.update') {
      const patch: Partial<Pick<ConversationEmbedInit, 'theme' | 'locale'>> = {}
      if (p.theme === 'dark' || p.theme === 'light') patch.theme = p.theme
      if (typeof p.locale === 'string') patch.locale = p.locale
      this.options.onUpdate?.(patch)
    }
    if (type === 'embed.send') {
      const message = readEmbedSend(p)
      if (message) this.options.onSend?.(message)
      else this.error('invalid_params')
    }
  }
  private post(type: string, payload: unknown): void {
    if (this.ready && this.parentOrigin) window.parent.postMessage(embedEnvelope(type, payload, CONVERSATION_EMBED), this.parentOrigin)
  }
  state(state: ConversationEmbedState): void { this.post('embed.state', state) }
  turn(mode: ConversationEmbedTurnMode): void { this.post('embed.turn', { mode }) }
  error(code: ConversationEmbedErrorCode): void { this.post('embed.error', { code }) }
  dispose(): void { clearInterval(this.hello); window.removeEventListener('message', this.listener) }
}
