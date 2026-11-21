/* Repeating events of the standard calendar table (`buckyos.calendar@1`, buckyos aiworkspace control mechanism TODO
 * G10, Q4): the iCalendar RRULE subset a mainstream calendar lets a user pick — every day / weekday / week on given
 * days / month on a day or the n-th (last) weekday / year, an interval, an end date or a count — parsed, written,
 * described and expanded here. The calendar control and the Agent commands expand with this one module; the core
 * checks the same subset (src/frame/aiworkspace/core/src/standard.rs). Anything outside it is an error naming the part,
 * never silently simplified: such rules live in `ext.rule_text` with the occurrences an Agent writes. */

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
/** Weekdays as RRULE writes them; index 0 is Monday. */
export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const
export type Weekday = (typeof WEEKDAYS)[number]

export interface ByDay { weekday: number; ordinal?: number }

export interface RRule {
  freq: Freq
  interval: number
  count?: number
  /** `YYYY-MM-DD` (a date) or an ISO UTC instant. */
  until?: string
  byDay?: ByDay[]
  byMonthDay?: number[]
  byMonth?: number[]
  bySetPos?: number
  /** Week start, 0 = Monday (the default). */
  wkst: number
}

export class RRuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RRuleError'
  }
}

const FREQS: Freq[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']
const MAX_COUNT = 1000
const MAX_INTERVAL = 999

function intIn(part: string, value: string, lo: number, hi: number, zero = false): number {
  if (!/^[+-]?\d{1,3}$/.test(value)) throw new RRuleError(`${part}: ${value} is not a number`)
  const n = Number(value)
  if (n < lo || n > hi || (!zero && n === 0)) throw new RRuleError(`${part}: ${value} is out of range`)
  return n
}

function list(part: string, value: string, max: number): string[] {
  const items = value.split(',')
  if (items.length === 0 || items.length > max || items.some((x) => x === '')) throw new RRuleError(`${part}: at most ${max} comma-separated values`)
  return items
}

function untilOf(value: string): string {
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(value)
  if (m) {
    const date = `${m[1]}-${m[2]}-${m[3]}`
    if (!isDate(date)) throw new RRuleError(`UNTIL: ${value} is not a date`)
    return date
  }
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value)
  if (m) {
    const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
    if (!isDate(`${m[1]}-${m[2]}-${m[3]}`) || +m[4] > 23 || +m[5] > 59 || +m[6] > 59) throw new RRuleError(`UNTIL: ${value} is not a UTC time`)
    return new Date(ms).toISOString()
  }
  throw new RRuleError(`UNTIL: ${value} must be YYYYMMDD or YYYYMMDDTHHMMSSZ`)
}

/** Parse a rule of the subset (an optional `RRULE:` prefix is accepted). Throws `RRuleError` naming the part. */
export function parseRRule(text: string): RRule {
  const body = text.startsWith('RRULE:') ? text.slice(6) : text
  if (body.trim() === '') throw new RRuleError('empty rule')
  const seen = new Set<string>()
  const raw: Record<string, string> = {}
  for (const part of body.split(';')) {
    const eq = part.indexOf('=')
    if (eq <= 0) throw new RRuleError(`${part || '(empty)'}: expected NAME=VALUE`)
    const name = part.slice(0, eq)
    const value = part.slice(eq + 1)
    if (name !== name.toUpperCase() || value !== value.toUpperCase()) throw new RRuleError(`${part}: write the rule in upper case`)
    if (seen.has(name)) throw new RRuleError(`${name}: given twice`)
    seen.add(name)
    if (!['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'BYMONTHDAY', 'BYMONTH', 'BYSETPOS', 'WKST'].includes(name)) {
      throw new RRuleError(`${name}: not supported (supported: FREQ, INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY, BYMONTH, BYSETPOS, WKST)`)
    }
    if (value === '') throw new RRuleError(`${name}: empty value`)
    raw[name] = value
  }
  if (!raw.FREQ) throw new RRuleError('FREQ is required')
  if (!FREQS.includes(raw.FREQ as Freq)) throw new RRuleError(`FREQ: ${raw.FREQ} is not supported (DAILY, WEEKLY, MONTHLY, YEARLY)`)
  const freq = raw.FREQ as Freq
  const rule: RRule = { freq, interval: 1, wkst: 0 }
  if (raw.INTERVAL !== undefined) rule.interval = intIn('INTERVAL', raw.INTERVAL, 1, MAX_INTERVAL)
  if (raw.COUNT !== undefined && raw.UNTIL !== undefined) throw new RRuleError('COUNT and UNTIL cannot both be given')
  if (raw.COUNT !== undefined) rule.count = intIn('COUNT', raw.COUNT, 1, MAX_COUNT)
  if (raw.UNTIL !== undefined) rule.until = untilOf(raw.UNTIL)
  if (raw.BYDAY !== undefined) {
    rule.byDay = list('BYDAY', raw.BYDAY, 7).map((item) => {
      const m = /^([+-]?\d)?(MO|TU|WE|TH|FR|SA|SU)$/.exec(item)
      if (!m) throw new RRuleError(`BYDAY: ${item} is not a weekday`)
      const weekday = WEEKDAYS.indexOf(m[2] as Weekday)
      if (m[1] === undefined) return { weekday }
      if (freq !== 'MONTHLY' && freq !== 'YEARLY') throw new RRuleError(`BYDAY: ${item}: an ordinal needs FREQ=MONTHLY or YEARLY`)
      return { weekday, ordinal: intIn('BYDAY', m[1], -5, 5) }
    })
    const keys = rule.byDay.map((d) => `${d.ordinal ?? ''}${d.weekday}`)
    if (new Set(keys).size !== keys.length) throw new RRuleError('BYDAY: repeated day')
  }
  if (raw.BYMONTHDAY !== undefined) {
    if (freq !== 'MONTHLY' && freq !== 'YEARLY') throw new RRuleError('BYMONTHDAY needs FREQ=MONTHLY or YEARLY')
    rule.byMonthDay = list('BYMONTHDAY', raw.BYMONTHDAY, 31).map((v) => {
      const n = intIn('BYMONTHDAY', v, -1, 31)
      return n
    })
    if (new Set(rule.byMonthDay).size !== rule.byMonthDay.length) throw new RRuleError('BYMONTHDAY: repeated day')
  }
  if (raw.BYMONTH !== undefined) {
    if (freq !== 'YEARLY') throw new RRuleError('BYMONTH needs FREQ=YEARLY')
    rule.byMonth = list('BYMONTH', raw.BYMONTH, 12).map((v) => intIn('BYMONTH', v, 1, 12))
    if (new Set(rule.byMonth).size !== rule.byMonth.length) throw new RRuleError('BYMONTH: repeated month')
  }
  if (raw.BYSETPOS !== undefined) {
    if (freq !== 'MONTHLY' || !rule.byDay) throw new RRuleError('BYSETPOS needs FREQ=MONTHLY and BYDAY')
    rule.bySetPos = intIn('BYSETPOS', raw.BYSETPOS, -5, 5)
  }
  if (raw.WKST !== undefined) {
    const w = WEEKDAYS.indexOf(raw.WKST as Weekday)
    if (w < 0) throw new RRuleError(`WKST: ${raw.WKST} is not a weekday`)
    rule.wkst = w
  }
  return rule
}

/** The rule as RRULE text, parts in a fixed order. */
export function formatRRule(rule: RRule): string {
  const parts = [`FREQ=${rule.freq}`]
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`)
  if (rule.byMonth?.length) parts.push(`BYMONTH=${rule.byMonth.join(',')}`)
  if (rule.byMonthDay?.length) parts.push(`BYMONTHDAY=${rule.byMonthDay.join(',')}`)
  if (rule.byDay?.length) parts.push(`BYDAY=${rule.byDay.map((d) => `${d.ordinal ?? ''}${WEEKDAYS[d.weekday]}`).join(',')}`)
  if (rule.bySetPos !== undefined) parts.push(`BYSETPOS=${rule.bySetPos}`)
  if (rule.count !== undefined) parts.push(`COUNT=${rule.count}`)
  if (rule.until !== undefined) parts.push(`UNTIL=${rule.until.length === 10 ? rule.until.replace(/-/g, '') : rule.until.replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`)
  if (rule.wkst !== 0) parts.push(`WKST=${WEEKDAYS[rule.wkst]}`)
  return parts.join(';')
}

// ---- dates (days since 1970-01-01, proleptic Gregorian, no time zone)

export function isDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  const y = +m[1], mo = +m[2], d = +m[3]
  return y >= 1 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo)
}
export const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
export function daysInMonth(y: number, m: number): number {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
}
export const dayNumber = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
export function dayOf(date: string): number {
  return dayNumber(+date.slice(0, 4), +date.slice(5, 7), +date.slice(8, 10))
}
export function dateOf(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10)
}
export function ymdOf(day: number): { y: number; m: number; d: number } {
  const t = new Date(day * 86_400_000)
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}
/** Weekday of a day number, 0 = Monday. */
export const weekdayOf = (day: number) => (((day + 3) % 7) + 7) % 7

// ---- time zones (Intl only)

const formatters = new Map<string, Intl.DateTimeFormat>()
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    formatters.set(tz, f)
  }
  return f
}

/** Is `tz` a time zone this runtime knows? */
export function isTimeZone(tz: string): boolean {
  try {
    formatter(tz)
    return true
  } catch {
    return false
  }
}

/** The wall clock of `ms` in `tz`. */
export function zonedParts(ms: number, tz: string): { y: number; m: number; d: number; h: number; mi: number; s: number } {
  const parts: Record<string, number> = {}
  for (const p of formatter(tz).formatToParts(new Date(ms))) if (p.type !== 'literal') parts[p.type] = Number(p.value)
  return { y: parts.year, m: parts.month, d: parts.day, h: parts.hour === 24 ? 0 : parts.hour, mi: parts.minute, s: parts.second }
}

function offsetMs(ms: number, tz: string): number {
  const p = zonedParts(ms, tz)
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000
}

/** The instant of a wall clock in `tz` (a time skipped by a clock change moves forward by the change). */
export function zonedToUtc(day: number, minuteOfDay: number, secondOfMinute: number, tz: string): number {
  const local = day * 86_400_000 + minuteOfDay * 60_000 + secondOfMinute * 1000
  const first = local - offsetMs(local, tz)
  const second = local - offsetMs(first, tz)
  // A gap has no fixed point; choosing the later instant advances the skipped wall time.
  return second !== first && local - offsetMs(second, tz) !== second ? Math.max(first, second) : second
}

/** The local date (day number) of an instant in `tz`. */
export function localDay(ms: number, tz: string): number {
  const p = zonedParts(ms, tz)
  return dayNumber(p.y, p.m, p.d)
}

// ---- expansion

/** Where a series starts: an all-day date, or an instant with the zone it repeats in. */
export type SeriesStart = { kind: 'date'; date: string } | { kind: 'datetime'; utc: string; tz: string }

export interface Occurrence {
  /** The occurrence's identity within its series: its original start as the event writes it (a date, or an ISO UTC instant). */
  original: string
  /** All-day: the date. */
  date?: string
  /** Timed: the instant (ms). */
  startMs?: number
}

export interface ExpandOptions {
  /** Originals excluded from the series (`ext.exdate`). */
  exdate?: readonly string[]
  /** Length of one occurrence (timed: ms, all-day: days − 1), so one that started before the window but overlaps it is kept. */
  durationMs?: number
  durationDays?: number
  /** The viewer's zone: all-day occurrences are dates on the viewer's calendar. Default UTC. */
  viewerTz?: string
  /** At most this many occurrences (default 2000). */
  limit?: number
  onTruncated?: () => void
}

const MAX_PERIODS = 200_000

/** Candidate days of one period (sorted), before the start / COUNT / UNTIL filters. */
function candidates(rule: RRule, period: number, startDay: number): number[] {
  const s = ymdOf(startDay)
  const out: number[] = []
  const byDayAll = (day0: number, len: number, wanted: ByDay[]) => {
    for (let i = 0; i < len; i++) if (wanted.some((w) => w.ordinal === undefined && w.weekday === weekdayOf(day0 + i))) out.push(day0 + i)
  }
  const nth = (day0: number, len: number, w: ByDay) => {
    const days: number[] = []
    for (let i = 0; i < len; i++) if (weekdayOf(day0 + i) === w.weekday) days.push(day0 + i)
    const k = w.ordinal! > 0 ? w.ordinal! - 1 : days.length + w.ordinal!
    if (k >= 0 && k < days.length) out.push(days[k])
  }
  const monthDays = (y: number, m: number, list: number[]) => {
    const n = daysInMonth(y, m)
    for (const d of list) {
      const day = d > 0 ? d : n + d + 1
      if (day >= 1 && day <= n) out.push(dayNumber(y, m, day))
    }
  }
  switch (rule.freq) {
    case 'DAILY': {
      const day = startDay + period * rule.interval
      const { m, d } = ymdOf(day)
      if (rule.byMonth && !rule.byMonth.includes(m)) break
      if (rule.byMonthDay && !rule.byMonthDay.some((x) => (x > 0 ? x === d : daysInMonth(ymdOf(day).y, m) + x + 1 === d))) break
      if (rule.byDay && !rule.byDay.some((w) => w.weekday === weekdayOf(day))) break
      out.push(day)
      break
    }
    case 'WEEKLY': {
      const weekStart = startDay - ((weekdayOf(startDay) - rule.wkst + 7) % 7) + period * rule.interval * 7
      const wanted = rule.byDay ?? [{ weekday: weekdayOf(startDay) }]
      byDayAll(weekStart, 7, wanted)
      if (rule.byMonth) return out.filter((d) => rule.byMonth!.includes(ymdOf(d).m)).sort((a, b) => a - b)
      break
    }
    case 'MONTHLY': {
      const index = s.y * 12 + (s.m - 1) + period * rule.interval
      const y = Math.floor(index / 12), m = (index % 12) + 1
      const day0 = dayNumber(y, m, 1), len = daysInMonth(y, m)
      if (rule.byMonthDay) {
        monthDays(y, m, rule.byMonthDay)
        if (rule.byDay) {
          const keep = out.filter((d) => rule.byDay!.some((w) => w.weekday === weekdayOf(d)))
          out.length = 0
          out.push(...keep)
        }
      } else if (rule.byDay) {
        byDayAll(day0, len, rule.byDay)
        for (const w of rule.byDay) if (w.ordinal !== undefined) nth(day0, len, w)
      } else if (s.d <= len) out.push(dayNumber(y, m, s.d))
      break
    }
    case 'YEARLY': {
      const y = s.y + period * rule.interval
      if (rule.byDay && !rule.byMonth && !rule.byMonthDay) {
        const day0 = dayNumber(y, 1, 1), len = isLeap(y) ? 366 : 365
        byDayAll(day0, len, rule.byDay)
        for (const w of rule.byDay) if (w.ordinal !== undefined) nth(day0, len, w)
        break
      }
      const months = rule.byMonth ?? [s.m]
      for (const m of months) {
        if (rule.byMonthDay) monthDays(y, m, rule.byMonthDay)
        else if (rule.byDay) {
          const day0 = dayNumber(y, m, 1), len = daysInMonth(y, m)
          byDayAll(day0, len, rule.byDay)
          for (const w of rule.byDay) if (w.ordinal !== undefined) nth(day0, len, w)
        } else if (s.d <= daysInMonth(y, m)) out.push(dayNumber(y, m, s.d))
      }
      if (rule.byMonthDay && rule.byDay) {
        const keep = out.filter((d) => rule.byDay!.some((w) => w.weekday === weekdayOf(d)))
        out.length = 0
        out.push(...keep)
      }
      break
    }
  }
  const sorted = [...new Set(out)].sort((a, b) => a - b)
  if (rule.bySetPos !== undefined) {
    const k = rule.bySetPos > 0 ? rule.bySetPos - 1 : sorted.length + rule.bySetPos
    return k >= 0 && k < sorted.length ? [sorted[k]] : []
  }
  return sorted
}

/** The first day of period `p` (candidates of the period never fall before it). */
function periodStart(rule: RRule, p: number, startDay: number): number {
  const s = ymdOf(startDay)
  switch (rule.freq) {
    case 'DAILY': return startDay + p * rule.interval
    case 'WEEKLY': return startDay - ((weekdayOf(startDay) - rule.wkst + 7) % 7) + p * rule.interval * 7
    case 'MONTHLY': {
      const index = s.y * 12 + (s.m - 1) + p * rule.interval
      return dayNumber(Math.floor(index / 12), (index % 12) + 1, 1)
    }
    case 'YEARLY': return dayNumber(s.y + p * rule.interval, 1, 1)
  }
}

/** The last period whose days all fall before `day` (−1 when none): what may be skipped when nothing is counted. */
function periodsBefore(rule: RRule, startDay: number, day: number): number {
  const s = ymdOf(startDay)
  const t = ymdOf(day)
  let p: number
  switch (rule.freq) {
    case 'DAILY': p = Math.floor((day - startDay) / rule.interval); break
    case 'WEEKLY': p = Math.floor((day - periodStart(rule, 0, startDay)) / (7 * rule.interval)); break
    case 'MONTHLY': p = Math.floor((t.y * 12 + t.m - (s.y * 12 + s.m)) / rule.interval); break
    case 'YEARLY': p = Math.floor((t.y - s.y) / rule.interval); break
  }
  return Math.max(-1, p - 1)
}

/** The occurrences of a series overlapping the window `[fromMs, toMs)`, in order. DTSTART is always the first
 * occurrence (as mainstream calendars show it), counted by COUNT. Excluded originals (EXDATE) are left out but still
 * counted, as RFC 5545 says. */
export function expandSeries(rule: RRule, start: SeriesStart, window: { fromMs: number; toMs: number }, opts: ExpandOptions = {}): Occurrence[] {
  const limit = opts.limit ?? 2000
  const excluded = new Set(opts.exdate ?? [])
  const out: Occurrence[] = []
  let startDay: number
  let minute = 0, second = 0
  let tz = 'UTC'
  let fromDay: number, toDay: number
  const viewerTz = opts.viewerTz ?? 'UTC'
  if (start.kind === 'date') {
    startDay = dayOf(start.date)
    fromDay = localDay(window.fromMs, viewerTz) - (opts.durationDays ?? 0)
    toDay = localDay(window.toMs - 1, viewerTz)
  } else {
    tz = start.tz
    const ms = Date.parse(start.utc)
    const p = zonedParts(ms, tz)
    startDay = dayNumber(p.y, p.m, p.d)
    minute = p.h * 60 + p.mi
    second = p.s
    // generous day bounds in the series' zone; the instants are compared exactly when emitted
    fromDay = localDay(window.fromMs - (opts.durationMs ?? 0), tz) - 1
    toDay = localDay(window.toMs, tz) + 1
  }
  const untilDay = rule.until?.length === 10 ? dayOf(rule.until) : undefined
  const untilMs = rule.until && rule.until.length > 10 ? Date.parse(rule.until) : undefined
  let count = 0
  /** false: the series is over. */
  const emit = (day: number): boolean => {
    if (rule.count !== undefined && count >= rule.count) return false
    if (untilDay !== undefined && day > untilDay) return false
    let occ: Occurrence
    if (start.kind === 'date') {
      if (untilMs !== undefined && day * 86_400_000 > untilMs) return false
      const date = dateOf(day)
      occ = { original: date, date }
    } else {
      const firstMs = Date.parse(start.utc)
      const ms = day === startDay ? firstMs : zonedToUtc(day, minute, second, tz) + new Date(firstMs).getUTCMilliseconds()
      if (untilMs !== undefined && ms > untilMs) return false
      occ = { original: new Date(ms).toISOString(), startMs: ms }
    }
    count += 1
    if (excluded.has(occ.original)) return true
    if (start.kind === 'date') {
      if (day >= fromDay && day <= toDay) out.push(occ)
    } else if (occ.startMs! + (opts.durationMs ?? 0) > window.fromMs && occ.startMs! < window.toMs) out.push(occ)
    return true
  }
  if (startDay > toDay || !emit(startDay)) return out
  // nothing counted: the periods wholly before the window are skipped
  let period = rule.count === undefined ? periodsBefore(rule, startDay, fromDay) + 1 : 0
  for (let guard = 0; guard < MAX_PERIODS && out.length < limit; guard++, period++) {
    if (periodStart(rule, period, startDay) > toDay) return out
    for (const day of candidates(rule, period, startDay)) {
      if (day <= startDay) continue
      if (day > toDay) return out
      if (!emit(day)) return out
      if (out.length >= limit) {
        opts.onTruncated?.()
        return out
      }
    }
  }
  if (periodStart(rule, period, startDay) <= toDay) opts.onTruncated?.()
  return out
}

/** The series of an event record's values (`start` / `start_date`, `ext.tz`), or null when it does not repeat. */
export function seriesStartOf(values: { all_day?: unknown; start?: unknown; start_date?: unknown }, tz: string | undefined, fallbackTz = 'UTC'): SeriesStart | null {
  if (values.all_day === true) return typeof values.start_date === 'string' ? { kind: 'date', date: values.start_date } : null
  return typeof values.start === 'string' ? { kind: 'datetime', utc: values.start, tz: tz && isTimeZone(tz) ? tz : fallbackTz } : null
}

/** The original of the occurrence that starts at `ms` (timed) or on `date` (all-day): its identity in `ext.exdate` /
 * `ext.recurrence_id.original`. */
export function originalOf(occ: { date?: string; startMs?: number }): string {
  return occ.date ?? new Date(occ.startMs!).toISOString()
}

/** `<record_id>@<original>`: an occurrence's id, apart from where it is planned (D4 §5.5). */
export function occurrenceId(recordId: string, original: string): string {
  return `${recordId}@${original}`
}
export function parseOccurrenceId(id: string): { recordId: string; original: string | null } {
  const at = id.indexOf('@')
  return at < 0 ? { recordId: id, original: null } : { recordId: id.slice(0, at), original: id.slice(at + 1) }
}

// ---- the choices a mainstream calendar offers, and a description

/** The languages rules are described in: Simplified Chinese ('zh'), Traditional Chinese, English, Japanese,
 * Korean, French, German, Spanish, Russian and Arabic. Any other value reads English. */
export type RecurrenceLocale = 'zh' | 'zh-TW' | 'en' | 'ja' | 'ko' | 'fr' | 'de' | 'es' | 'ru' | 'ar'

/** How one language says the parts of a rule. Weekdays and months are indexes (0 = Monday; 1 = January). */
interface Phrasebook {
  /** A weekday as an item of the rule's list ("Monday", "周一", "le lundi", "в понедельник"). */
  day(wd: number): string
  /** The `ord`-th (negative: from the end) weekday of a month, as an item ("first Monday", "第一个周一"). */
  nth(ord: number, wd: number): string
  /** The `ord`-th working day of a month ("the first weekday"). */
  nthWorkday(ord: number): string
  /** The `ord`-th of the given weekdays (BYSETPOS over weekdays that are not the working days; one weekday: `nth`). */
  nthOf(ord: number, days: number[]): string
  /** Monthly by weekdays without a position. */
  monthlyDays(items: string[]): string
  /** A day of a month (-1: the last). */
  monthDay(d: number): string
  join(items: string[]): string
  daily(n: number): string
  workdays: string
  weekly(n: number, on: string): string
  monthly(n: number, on: string): string
  yearly(n: number, months: number[] | undefined, monthDays: number[] | undefined, days: string[] | undefined): string
  count(n: number): string
  until(date: string): string
  preset: {
    none: string
    daily: string
    weekdays: string
    weekly(wd: number): string
    monthlyDay(d: number): string
    monthlyNth(nth: number, wd: number): string
    monthlyLast(wd: number): string
    yearly(m: number, d: number): string
  }
}

/** `a, b and c` with the language's last joiner. */
const andJoin = (word: string) => (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} ${word} ${xs[xs.length - 1]}` : xs.join(''))
/** The CLDR plural form of a Russian count: one (1, 21…), few (2–4, 22–24…), many (the rest). */
const ruPlural = (n: number, one: string, few: string, many: string) => {
  const d = n % 10, h = n % 100
  return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many
}

const ZH_ORD: Record<number, string> = { 1: '第一个', 2: '第二个', 3: '第三个', 4: '第四个', 5: '第五个', [-1]: '最后一个', [-2]: '倒数第二个', [-3]: '倒数第三个', [-4]: '倒数第四个', [-5]: '倒数第五个' }
const ZH_WD = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const zh: Phrasebook = {
  day: (wd) => ZH_WD[wd],
  nth: (o, wd) => `${ZH_ORD[o]}${ZH_WD[wd]}`,
  nthWorkday: (o) => `${ZH_ORD[o]}工作日`,
  nthOf: (o, days) => `${ZH_ORD[o]}${days.map((wd) => ZH_WD[wd]).join('、')}`,
  monthlyDays: (items) => items.join('、'),
  monthDay: (d) => (d === -1 ? '最后一天' : `${d} 日`),
  join: (xs) => xs.join('、'),
  daily: (n) => (n === 1 ? '每天' : `每 ${n} 天`),
  workdays: '每个工作日',
  weekly: (n, on) => `${n === 1 ? '每周' : `每 ${n} 周的`}${on}`,
  monthly: (n, on) => `${n === 1 ? '每月' : `每 ${n} 个月的`}${on}`,
  yearly: (n, months, mdays, days) => `${n === 1 ? '每年' : `每 ${n} 年的`}${months ? months.map((m) => `${m} 月`).join('、') : ''}${mdays ? mdays.map(zh.monthDay).join('、') : days ? days.join('、') : ''}`,
  count: (n) => `，共 ${n} 次`,
  until: (date) => `，到 ${date} 为止`,
  preset: {
    none: '不重复', daily: '每天', weekdays: '每个工作日（周一至周五）',
    weekly: (wd) => `每周的${ZH_WD[wd]}`, monthlyDay: (d) => `每月 ${d} 日`, monthlyNth: (n, wd) => `每月${ZH_ORD[n]}${ZH_WD[wd]}`,
    monthlyLast: (wd) => `每月最后一个${ZH_WD[wd]}`, yearly: (m, d) => `每年 ${m} 月 ${d} 日`,
  },
}

const TW_ORD: Record<number, string> = { 1: '第一個', 2: '第二個', 3: '第三個', 4: '第四個', 5: '第五個', [-1]: '最後一個', [-2]: '倒數第二個', [-3]: '倒數第三個', [-4]: '倒數第四個', [-5]: '倒數第五個' }
const TW_WD = ['週一', '週二', '週三', '週四', '週五', '週六', '週日']
const zhTW: Phrasebook = {
  day: (wd) => TW_WD[wd],
  nth: (o, wd) => `${TW_ORD[o]}${TW_WD[wd]}`,
  nthWorkday: (o) => `${TW_ORD[o]}工作日`,
  nthOf: (o, days) => `${TW_ORD[o]}${days.map((wd) => TW_WD[wd]).join('、')}`,
  monthlyDays: (items) => items.join('、'),
  monthDay: (d) => (d === -1 ? '最後一天' : `${d} 日`),
  join: (xs) => xs.join('、'),
  daily: (n) => (n === 1 ? '每天' : `每 ${n} 天`),
  workdays: '每個工作日',
  weekly: (n, on) => `${n === 1 ? '每週' : `每 ${n} 週的`}${on}`,
  monthly: (n, on) => `${n === 1 ? '每月' : `每 ${n} 個月的`}${on}`,
  yearly: (n, months, mdays, days) => `${n === 1 ? '每年' : `每 ${n} 年的`}${months ? months.map((m) => `${m} 月`).join('、') : ''}${mdays ? mdays.map(zhTW.monthDay).join('、') : days ? days.join('、') : ''}`,
  count: (n) => `，共 ${n} 次`,
  until: (date) => `，到 ${date} 為止`,
  preset: {
    none: '不重複', daily: '每天', weekdays: '每個工作日（週一至週五）',
    weekly: (wd) => `每週的${TW_WD[wd]}`, monthlyDay: (d) => `每月 ${d} 日`, monthlyNth: (n, wd) => `每月${TW_ORD[n]}${TW_WD[wd]}`,
    monthlyLast: (wd) => `每月最後一個${TW_WD[wd]}`, yearly: (m, d) => `每年 ${m} 月 ${d} 日`,
  },
}

const EN_ORD: Record<number, string> = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', [-1]: 'last', [-2]: 'second to last', [-3]: 'third to last', [-4]: 'fourth to last', [-5]: 'fifth to last' }
const EN_WD = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const EN_MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const en: Phrasebook = {
  day: (wd) => EN_WD[wd],
  nth: (o, wd) => `${EN_ORD[o]} ${EN_WD[wd]}`,
  nthWorkday: (o) => `the ${EN_ORD[o]} weekday`,
  nthOf: (o, days) => (days.length === 1 ? `the ${EN_ORD[o]} ${EN_WD[days[0]]}` : `the ${EN_ORD[o]} of ${andJoin('and')(days.map((wd) => EN_WD[wd]))}`),
  monthlyDays: (items) => `the ${andJoin('and')(items)}`,
  monthDay: (d) => (d === -1 ? 'the last day' : `day ${d}`),
  join: andJoin('and'),
  daily: (n) => (n === 1 ? 'every day' : `every ${n} days`),
  workdays: 'every weekday',
  weekly: (n, on) => `${n === 1 ? 'every week' : `every ${n} weeks`}${on ? ` on ${on}` : ''}`,
  monthly: (n, on) => `${n === 1 ? 'every month' : `every ${n} months`}${on ? ` on ${on}` : ''}`,
  yearly: (n, months, mdays, days) => {
    let on = months ? andJoin('and')(months.map((m) => EN_MONTH[m - 1])) : ''
    if (mdays) on += ` ${andJoin('and')(mdays.map((d) => (d === -1 ? 'last day' : String(d))))}`
    else if (days) on += ` on the ${andJoin('and')(days)}`
    return `${n === 1 ? 'every year' : `every ${n} years`}${on.trim() ? ` in ${on.trim()}` : ''}`
  },
  count: (n) => `, ${n} times`,
  until: (date) => `, until ${date}`,
  preset: {
    none: 'Does not repeat', daily: 'Daily', weekdays: 'Every weekday (Monday to Friday)',
    weekly: (wd) => `Weekly on ${EN_WD[wd]}`, monthlyDay: (d) => `Monthly on day ${d}`, monthlyNth: (n, wd) => `Monthly on the ${EN_ORD[n]} ${EN_WD[wd]}`,
    monthlyLast: (wd) => `Monthly on the last ${EN_WD[wd]}`, yearly: (m, d) => `Annually on ${EN_MONTH[m - 1]} ${d}`,
  },
}

const JA_WD = ['月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日', '日曜日']
const jaOrd = (o: number) => (o > 0 ? `第${o}` : o === -1 ? '最終' : `最後から${-o}番目の`)
const ja: Phrasebook = {
  day: (wd) => JA_WD[wd],
  nth: (o, wd) => `${jaOrd(o)}${JA_WD[wd]}`,
  nthWorkday: (o) => `${jaOrd(o)}平日`,
  nthOf: (o, days) => `${jaOrd(o)}${days.map((wd) => JA_WD[wd]).join('・')}`,
  monthlyDays: (items) => items.join('、'),
  monthDay: (d) => (d === -1 ? '最終日' : `${d}日`),
  join: (xs) => xs.join('、'),
  daily: (n) => (n === 1 ? '毎日' : `${n}日ごと`),
  workdays: '毎週平日',
  weekly: (n, on) => (n === 1 ? `毎週${on}` : `${n}週間ごと${on ? `の${on}` : ''}`),
  monthly: (n, on) => (n === 1 ? `毎月${on}` : `${n}か月ごと${on ? `の${on}` : ''}`),
  yearly: (n, months, mdays, days) => {
    const on = `${months ? months.map((m) => `${m}月`).join('、') : ''}${mdays ? mdays.map(ja.monthDay).join('、') : days ? days.join('、') : ''}`
    return n === 1 ? `毎年${on}` : `${n}年ごと${on ? `の${on}` : ''}`
  },
  count: (n) => `、${n}回`,
  until: (date) => `、${date}まで`,
  preset: {
    none: '繰り返さない', daily: '毎日', weekdays: '毎週平日（月曜日～金曜日）',
    weekly: (wd) => `毎週${JA_WD[wd]}`, monthlyDay: (d) => `毎月${d}日`, monthlyNth: (n, wd) => `毎月第${n}${JA_WD[wd]}`,
    monthlyLast: (wd) => `毎月最終${JA_WD[wd]}`, yearly: (m, d) => `毎年${m}月${d}日`,
  },
}

const KO_WD = ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일']
const KO_ORD: Record<number, string> = { 1: '첫째', 2: '둘째', 3: '셋째', 4: '넷째', 5: '다섯째', [-1]: '마지막', [-2]: '끝에서 둘째', [-3]: '끝에서 셋째', [-4]: '끝에서 넷째', [-5]: '끝에서 다섯째' }
const koOn = (head: string, on: string) => (on ? `${head} ${on}` : head)
const ko: Phrasebook = {
  day: (wd) => KO_WD[wd],
  nth: (o, wd) => `${KO_ORD[o]} ${KO_WD[wd]}`,
  nthWorkday: (o) => `${KO_ORD[o]} 평일`,
  nthOf: (o, days) => `${KO_ORD[o]} ${days.map((wd) => KO_WD[wd]).join('·')}`,
  monthlyDays: (items) => items.join(', '),
  monthDay: (d) => (d === -1 ? '마지막 날' : `${d}일`),
  join: (xs) => xs.join(', '),
  daily: (n) => (n === 1 ? '매일' : `${n}일마다`),
  workdays: '매주 평일',
  weekly: (n, on) => koOn(n === 1 ? '매주' : `${n}주마다`, on),
  monthly: (n, on) => koOn(n === 1 ? '매월' : `${n}개월마다`, on),
  yearly: (n, months, mdays, days) => {
    const on = [months ? months.map((m) => `${m}월`).join(', ') : '', mdays ? mdays.map(ko.monthDay).join(', ') : days ? days.join(', ') : ''].filter(Boolean).join(' ')
    return koOn(n === 1 ? '매년' : `${n}년마다`, on)
  },
  count: (n) => `, ${n}회`,
  until: (date) => `, ${date}까지`,
  preset: {
    none: '반복 안 함', daily: '매일', weekdays: '매주 평일(월요일~금요일)',
    weekly: (wd) => `매주 ${KO_WD[wd]}`, monthlyDay: (d) => `매월 ${d}일`, monthlyNth: (n, wd) => `매월 ${KO_ORD[n]} ${KO_WD[wd]}`,
    monthlyLast: (wd) => `매월 마지막 ${KO_WD[wd]}`, yearly: (m, d) => `매년 ${m}월 ${d}일`,
  },
}

const FR_WD = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']
const FR_MONTH = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const FR_ORD: Record<number, string> = { 1: 'premier', 2: 'deuxième', 3: 'troisième', 4: 'quatrième', 5: 'cinquième' }
/** "le premier lundi", "le dernier lundi", "l'avant-dernier lundi", "le troisième lundi avant la fin". */
const frNth = (o: number, what: string) => (o > 0 ? `le ${FR_ORD[o]} ${what}` : o === -1 ? `le dernier ${what}` : o === -2 ? `l'avant-dernier ${what}` : `le ${FR_ORD[-o]} ${what} avant la fin`)
const frDay = (d: number) => (d === 1 ? '1er' : String(d))
const frOn = (head: string, on: string) => (on ? `${head} ${on}` : head)
const fr: Phrasebook = {
  day: (wd) => `le ${FR_WD[wd]}`,
  nth: (o, wd) => frNth(o, FR_WD[wd]),
  nthWorkday: (o) => frNth(o, 'jour ouvrable'),
  nthOf: (o, days) => frNth(o, days.length === 1 ? FR_WD[days[0]] : `jour parmi ${andJoin('et')(days.map((wd) => FR_WD[wd]))}`),
  monthlyDays: (items) => andJoin('et')(items),
  monthDay: (d) => (d === -1 ? 'le dernier jour' : `le ${frDay(d)}`),
  join: andJoin('et'),
  daily: (n) => (n === 1 ? 'tous les jours' : `tous les ${n} jours`),
  workdays: 'tous les jours ouvrables',
  weekly: (n, on) => frOn(n === 1 ? 'toutes les semaines' : `toutes les ${n} semaines`, on),
  monthly: (n, on) => frOn(n === 1 ? 'tous les mois' : `tous les ${n} mois`, on),
  yearly: (n, months, mdays, days) => {
    let on: string
    if (months?.length === 1 && mdays?.length === 1) on = mdays[0] === -1 ? `le dernier jour de ${FR_MONTH[months[0] - 1]}` : `le ${frDay(mdays[0])} ${FR_MONTH[months[0] - 1]}`
    else on = [mdays ? andJoin('et')(mdays.map(fr.monthDay)) : days ? andJoin('et')(days) : '', months ? `en ${andJoin('et')(months.map((m) => FR_MONTH[m - 1]))}` : ''].filter(Boolean).join(' ')
    return frOn(n === 1 ? 'tous les ans' : `tous les ${n} ans`, on)
  },
  count: (n) => `, ${n} fois`,
  until: (date) => `, jusqu’au ${date}`,
  preset: {
    none: 'Ne se répète pas', daily: 'Tous les jours', weekdays: 'Tous les jours ouvrables (du lundi au vendredi)',
    weekly: (wd) => `Toutes les semaines le ${FR_WD[wd]}`, monthlyDay: (d) => `Tous les mois le ${frDay(d)}`, monthlyNth: (n, wd) => `Tous les mois ${frNth(n, FR_WD[wd])}`,
    monthlyLast: (wd) => `Tous les mois le dernier ${FR_WD[wd]}`, yearly: (m, d) => `Tous les ans le ${frDay(d)} ${FR_MONTH[m - 1]}`,
  },
}

const DE_WD = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']
const DE_MONTH = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const DE_ORD: Record<number, string> = { 1: 'ersten', 2: 'zweiten', 3: 'dritten', 4: 'vierten', 5: 'fünften', [-1]: 'letzten', [-2]: 'vorletzten', [-3]: 'drittletzten', [-4]: 'viertletzten', [-5]: 'fünftletzten' }
const deOn = (head: string, on: string) => (on ? `${head} ${on}` : head)
const de: Phrasebook = {
  day: (wd) => `am ${DE_WD[wd]}`,
  nth: (o, wd) => `am ${DE_ORD[o]} ${DE_WD[wd]}`,
  nthWorkday: (o) => `am ${DE_ORD[o]} Werktag`,
  nthOf: (o, days) => (days.length === 1 ? `am ${DE_ORD[o]} ${DE_WD[days[0]]}` : `am ${DE_ORD[o]} Tag aus ${andJoin('und')(days.map((wd) => DE_WD[wd]))}`),
  monthlyDays: (items) => andJoin('und')(items),
  monthDay: (d) => (d === -1 ? 'am letzten Tag' : `am ${d}.`),
  join: andJoin('und'),
  daily: (n) => (n === 1 ? 'täglich' : `alle ${n} Tage`),
  workdays: 'an jedem Werktag',
  weekly: (n, on) => deOn(n === 1 ? 'wöchentlich' : `alle ${n} Wochen`, on),
  monthly: (n, on) => deOn(n === 1 ? 'monatlich' : `alle ${n} Monate`, on),
  yearly: (n, months, mdays, days) => {
    let on: string
    if (months?.length === 1 && mdays?.length === 1) on = mdays[0] === -1 ? `am letzten Tag im ${DE_MONTH[months[0] - 1]}` : `am ${mdays[0]}. ${DE_MONTH[months[0] - 1]}`
    else on = [mdays ? andJoin('und')(mdays.map(de.monthDay)) : days ? andJoin('und')(days) : '', months ? `im ${andJoin('und')(months.map((m) => DE_MONTH[m - 1]))}` : ''].filter(Boolean).join(' ')
    return deOn(n === 1 ? 'jährlich' : `alle ${n} Jahre`, on)
  },
  count: (n) => `, ${n}-mal`,
  until: (date) => `, bis ${date}`,
  preset: {
    none: 'Wiederholt sich nicht', daily: 'Täglich', weekdays: 'Jeden Werktag (Montag bis Freitag)',
    weekly: (wd) => `Wöchentlich am ${DE_WD[wd]}`, monthlyDay: (d) => `Monatlich am ${d}.`, monthlyNth: (n, wd) => `Monatlich am ${DE_ORD[n]} ${DE_WD[wd]}`,
    monthlyLast: (wd) => `Monatlich am letzten ${DE_WD[wd]}`, yearly: (m, d) => `Jährlich am ${d}. ${DE_MONTH[m - 1]}`,
  },
}

const ES_WD = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
const ES_MONTH = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const ES_ORD: Record<number, string> = { 1: 'primer', 2: 'segundo', 3: 'tercer', 4: 'cuarto', 5: 'quinto', [-1]: 'último', [-2]: 'penúltimo', [-3]: 'antepenúltimo', [-4]: 'cuarto desde el final', [-5]: 'quinto desde el final' }
/** "el primer lunes", "el cuarto lunes desde el final". */
const esNth = (o: number, what: string) => (o < -3 ? `el ${ES_ORD[-o]} ${what} desde el final` : `el ${ES_ORD[o]} ${what}`)
const esOn = (head: string, on: string) => (on ? `${head} ${on}` : head)
const es: Phrasebook = {
  day: (wd) => `el ${ES_WD[wd]}`,
  nth: (o, wd) => esNth(o, ES_WD[wd]),
  nthWorkday: (o) => esNth(o, 'día laborable'),
  nthOf: (o, days) => esNth(o, days.length === 1 ? ES_WD[days[0]] : `día entre ${andJoin('y')(days.map((wd) => ES_WD[wd]))}`),
  monthlyDays: (items) => andJoin('y')(items),
  monthDay: (d) => (d === -1 ? 'el último día' : `el día ${d}`),
  join: andJoin('y'),
  daily: (n) => (n === 1 ? 'todos los días' : `cada ${n} días`),
  workdays: 'todos los días laborables',
  weekly: (n, on) => esOn(n === 1 ? 'cada semana' : `cada ${n} semanas`, on),
  monthly: (n, on) => esOn(n === 1 ? 'cada mes' : `cada ${n} meses`, on),
  yearly: (n, months, mdays, days) => {
    let on: string
    if (months?.length === 1 && mdays?.length === 1) on = mdays[0] === -1 ? `el último día de ${ES_MONTH[months[0] - 1]}` : `el ${mdays[0]} de ${ES_MONTH[months[0] - 1]}`
    else on = [mdays ? andJoin('y')(mdays.map(es.monthDay)) : days ? andJoin('y')(days) : '', months ? `de ${andJoin('y')(months.map((m) => ES_MONTH[m - 1]))}` : ''].filter(Boolean).join(' ')
    return esOn(n === 1 ? 'cada año' : `cada ${n} años`, on)
  },
  count: (n) => `, ${n} veces`,
  until: (date) => `, hasta el ${date}`,
  preset: {
    none: 'No se repite', daily: 'Todos los días', weekdays: 'Todos los días laborables (de lunes a viernes)',
    weekly: (wd) => `Cada semana el ${ES_WD[wd]}`, monthlyDay: (d) => `Cada mes el día ${d}`, monthlyNth: (n, wd) => `Cada mes ${esNth(n, ES_WD[wd])}`,
    monthlyLast: (wd) => `Cada mes el último ${ES_WD[wd]}`, yearly: (m, d) => `Cada año el ${d} de ${ES_MONTH[m - 1]}`,
  },
}

/** Weekdays after "в" (accusative), their gender for the ordinal (m, f, n), and the ordinals in the accusative. */
const RU_WD = ['понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу', 'воскресенье']
const RU_WD_GENDER = [0, 0, 1, 0, 1, 1, 2]
const RU_ORD: Record<number, [string, string, string]> = {
  1: ['первый', 'первую', 'первое'], 2: ['второй', 'вторую', 'второе'], 3: ['третий', 'третью', 'третье'],
  4: ['четвёртый', 'четвёртую', 'четвёртое'], 5: ['пятый', 'пятую', 'пятое'],
  [-1]: ['последний', 'последнюю', 'последнее'], [-2]: ['предпоследний', 'предпоследнюю', 'предпоследнее'],
}
/** The month in a date ("15 марта") and after "в" ("в марте"). */
const RU_MONTH_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const RU_MONTH_PREP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре']
/** "в" — "во" before a cluster starting with "вт" ("во вторник", "во второй четверг"). */
const ruIn = (phrase: string) => `${/^вт/.test(phrase) ? 'во' : 'в'} ${phrase}`
const ruOrd = (o: number, gender: number) => (RU_ORD[o] ? RU_ORD[o][gender] : `${RU_ORD[-o][gender]} с конца`)
const ruOn = (head: string, on: string) => (on ? `${head} ${on}` : head)
const ru: Phrasebook = {
  day: (wd) => ruIn(RU_WD[wd]),
  nth: (o, wd) => ruIn(`${ruOrd(o, RU_WD_GENDER[wd])} ${RU_WD[wd]}`),
  nthWorkday: (o) => ruIn(`${ruOrd(o, 0)} рабочий день`),
  nthOf: (o, days) => (days.length === 1 ? ruIn(`${ruOrd(o, RU_WD_GENDER[days[0]])} ${RU_WD[days[0]]}`) : ruIn(`${ruOrd(o, 0)} из дней: ${days.map((wd) => RU_WD[wd]).join(', ')}`)),
  monthlyDays: (items) => andJoin('и')(items),
  monthDay: (d) => (d === -1 ? 'в последний день' : `${d}-го числа`),
  join: andJoin('и'),
  daily: (n) => (n === 1 ? 'каждый день' : `раз в ${n} ${ruPlural(n, 'день', 'дня', 'дней')}`),
  workdays: 'по будням',
  weekly: (n, on) => ruOn(n === 1 ? 'каждую неделю' : `раз в ${n} ${ruPlural(n, 'неделю', 'недели', 'недель')}`, on),
  monthly: (n, on) => ruOn(n === 1 ? 'каждый месяц' : `раз в ${n} ${ruPlural(n, 'месяц', 'месяца', 'месяцев')}`, on),
  yearly: (n, months, mdays, days) => {
    let on: string
    if (months?.length === 1 && mdays?.length === 1) on = mdays[0] === -1 ? `в последний день ${RU_MONTH_GEN[months[0] - 1]}` : `${mdays[0]} ${RU_MONTH_GEN[months[0] - 1]}`
    else on = [mdays ? andJoin('и')(mdays.map(ru.monthDay)) : days ? andJoin('и')(days) : '', months ? ruIn(andJoin('и')(months.map((m) => RU_MONTH_PREP[m - 1]))) : ''].filter(Boolean).join(' ')
    return ruOn(n === 1 ? 'каждый год' : `раз в ${n} ${ruPlural(n, 'год', 'года', 'лет')}`, on)
  },
  count: (n) => `, ${n} ${ruPlural(n, 'раз', 'раза', 'раз')}`,
  until: (date) => `, до ${date}`,
  preset: {
    none: 'Не повторяется', daily: 'Каждый день', weekdays: 'По будням (с понедельника по пятницу)',
    weekly: (wd) => `Каждую неделю ${ruIn(RU_WD[wd])}`, monthlyDay: (d) => `Каждый месяц ${d}-го числа`, monthlyNth: (n, wd) => `Каждый месяц ${ruIn(`${ruOrd(n, RU_WD_GENDER[wd])} ${RU_WD[wd]}`)}`,
    monthlyLast: (wd) => `Каждый месяц ${ruIn(`${ruOrd(-1, RU_WD_GENDER[wd])} ${RU_WD[wd]}`)}`, yearly: (m, d) => `Каждый год ${d} ${RU_MONTH_GEN[m - 1]}`,
  },
}

const AR_DAYS = ['الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد']
const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
const arNumber = new Intl.NumberFormat('ar')
const arList = (items: string[]) => items.join(' و')
const arOrdinal = (position: number) => {
  const ordinals = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس']
  if (position === -1) return 'الأخير'
  const ordinal = ordinals[Math.abs(position) - 1] ?? arNumber.format(Math.abs(position))
  return position < 0 ? ordinal + ' من النهاية' : ordinal
}
const arEvery = (n: number, one: string, two: string, few: string, many: string) => {
  if (n === 1) return 'كل ' + one
  if (n === 2) return 'كل ' + two
  return 'كل ' + arNumber.format(n) + ' ' + (n % 100 >= 3 && n % 100 <= 10 ? few : many)
}
const arOn = (frequency: string, on: string) => on ? frequency + '، في ' + on : frequency
const ar: Phrasebook = {
  day: (wd) => AR_DAYS[wd],
  nth: (o, wd) => `يوم ${AR_DAYS[wd]} ${arOrdinal(o)}`,
  nthWorkday: (o) => `يوم العمل ${arOrdinal(o)}`,
  nthOf: (o, days) => days.length === 1 ? ar.nth(o, days[0]) : `اليوم ${arOrdinal(o)} من بين أيام ${arList(days.map(ar.day))}`,
  monthlyDays: arList,
  monthDay: (d) => d === -1 ? 'اليوم الأخير' : d < 0 ? `اليوم ${arOrdinal(d)}` : `اليوم ${arNumber.format(d)}`,
  join: arList,
  daily: (n) => arEvery(n, 'يوم', 'يومين', 'أيام', 'يومًا'),
  workdays: 'من الاثنين إلى الجمعة',
  weekly: (n, on) => [arEvery(n, 'أسبوع', 'أسبوعين', 'أسابيع', 'أسبوعًا'), on].filter(Boolean).join('، '),
  monthly: (n, on) => arOn(arEvery(n, 'شهر', 'شهرين', 'أشهر', 'شهرًا'), on),
  yearly: (n, months, mdays, days) => {
    const month = months ? arList(months.map((m) => AR_MONTHS[m - 1])) : ''
    const day = mdays ? arList(mdays.map(ar.monthDay)) : arList(days ?? [])
    return arOn(arEvery(n, 'سنة', 'سنتين', 'سنوات', 'سنة'), [day, month].filter(Boolean).join(' من '))
  },
  count: (n) => `، عدد المرات: ${arNumber.format(n)}`,
  until: (date) => `، حتى ${date}`,
  preset: {
    none: 'بلا تكرار', daily: 'كل يوم', weekdays: 'أيام العمل (من الاثنين إلى الجمعة)',
    weekly: (wd) => `كل أسبوع يوم ${ar.day(wd)}`,
    monthlyDay: (d) => ar.monthly(1, ar.monthDay(d)),
    monthlyNth: (n, wd) => ar.monthly(1, ar.nth(n, wd)),
    monthlyLast: (wd) => ar.monthly(1, ar.nth(-1, wd)),
    yearly: (m, d) => `كل سنة في ${arNumber.format(d)} ${AR_MONTHS[m - 1]}`,
  },
}

const PHRASEBOOKS: Record<RecurrenceLocale, Phrasebook> = { zh, 'zh-TW': zhTW, en, ja, ko, fr, de, es, ru, ar }
const phrasebook = (locale: string): Phrasebook => PHRASEBOOKS[locale as RecurrenceLocale] ?? en

const isWorkdays = (d?: ByDay[]) => !!d && d.length === 5 && d.every((x) => x.ordinal === undefined) && [0, 1, 2, 3, 4].every((w) => d.some((x) => x.weekday === w))

/** A sentence for a rule ("每个工作日", "每月最后一个周五", "every 2 weeks on Monday, Wednesday, 10 times"). */
export function describeRRule(rule: RRule, locale: RecurrenceLocale = 'zh'): string {
  const p = phrasebook(locale)
  const n = rule.interval
  const days = (d: ByDay[]) => d.map((x) => (x.ordinal === undefined ? p.day(x.weekday) : p.nth(x.ordinal, x.weekday)))
  let text: string
  switch (rule.freq) {
    case 'DAILY':
      text = p.daily(n)
      break
    case 'WEEKLY':
      text = isWorkdays(rule.byDay) && n === 1 ? p.workdays : p.weekly(n, rule.byDay ? p.join(days(rule.byDay)) : '')
      break
    case 'MONTHLY': {
      let on = ''
      if (rule.byMonthDay) on = p.join(rule.byMonthDay.map(p.monthDay))
      else if (rule.byDay && rule.bySetPos !== undefined) {
        on = isWorkdays(rule.byDay) ? p.nthWorkday(rule.bySetPos) : p.nthOf(rule.bySetPos, rule.byDay.map((x) => x.weekday))
      } else if (rule.byDay) on = p.monthlyDays(days(rule.byDay))
      text = p.monthly(n, on)
      break
    }
    case 'YEARLY':
      text = p.yearly(n, rule.byMonth, rule.byMonthDay, rule.byMonthDay ? undefined : rule.byDay ? days(rule.byDay) : undefined)
      break
  }
  if (rule.count !== undefined) text += p.count(rule.count)
  if (rule.until !== undefined) text += p.until(rule.until.slice(0, 10))
  return text
}

export interface RecurrencePreset {
  id: 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly_day' | 'monthly_nth' | 'monthly_last' | 'yearly'
  label: string
  /** null: does not repeat. */
  rrule: string | null
}

/** The choices of a mainstream calendar's "repeat" menu for an event starting on `date` (`YYYY-MM-DD`, local). */
export function recurrencePresets(date: string, locale: RecurrenceLocale = 'zh'): RecurrencePreset[] {
  const day = dayOf(date)
  const { y, m, d } = ymdOf(day)
  const wd = weekdayOf(day)
  const nth = Math.floor((d - 1) / 7) + 1
  const last = d + 7 > daysInMonth(y, m)
  const p = phrasebook(locale).preset
  const w = WEEKDAYS[wd]
  const out: RecurrencePreset[] = [
    { id: 'none', label: p.none, rrule: null },
    { id: 'daily', label: p.daily, rrule: 'FREQ=DAILY' },
    { id: 'weekdays', label: p.weekdays, rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
    { id: 'weekly', label: p.weekly(wd), rrule: `FREQ=WEEKLY;BYDAY=${w}` },
    { id: 'monthly_day', label: p.monthlyDay(d), rrule: `FREQ=MONTHLY;BYMONTHDAY=${d}` },
  ]
  if (nth <= 4) out.push({ id: 'monthly_nth', label: p.monthlyNth(nth, wd), rrule: `FREQ=MONTHLY;BYDAY=${nth}${w}` })
  if (last) out.push({ id: 'monthly_last', label: p.monthlyLast(wd), rrule: `FREQ=MONTHLY;BYDAY=-1${w}` })
  out.push({ id: 'yearly', label: p.yearly(m, d), rrule: `FREQ=YEARLY;BYMONTH=${m};BYMONTHDAY=${d}` })
  return out
}
