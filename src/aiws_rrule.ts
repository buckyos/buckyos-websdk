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
  return second
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
      const ms = zonedToUtc(day, minute, second, tz)
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
    if (periodStart(rule, period, startDay) > toDay) break
    for (const day of candidates(rule, period, startDay)) {
      if (day <= startDay) continue
      if (day > toDay) return out
      if (!emit(day) || out.length >= limit) return out
    }
  }
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

export type RecurrenceLocale = 'zh' | 'en'

const ORD_ZH: Record<number, string> = { 1: '第一个', 2: '第二个', 3: '第三个', 4: '第四个', 5: '第五个', [-1]: '最后一个', [-2]: '倒数第二个', [-3]: '倒数第三个', [-4]: '倒数第四个', [-5]: '倒数第五个' }
const ORD_EN: Record<number, string> = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', [-1]: 'last', [-2]: 'second to last', [-3]: 'third to last', [-4]: 'fourth to last', [-5]: 'fifth to last' }
const WD_ZH = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const WD_EN = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const MONTH_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const isWorkdays = (d?: ByDay[]) => !!d && d.length === 5 && d.every((x) => x.ordinal === undefined) && [0, 1, 2, 3, 4].every((w) => d.some((x) => x.weekday === w))

/** A sentence for a rule ("每个工作日", "每月最后一个周五", "every 2 weeks on Monday, Wednesday, 10 times"). */
export function describeRRule(rule: RRule, locale: RecurrenceLocale = 'zh'): string {
  const zh = locale === 'zh'
  const n = rule.interval
  const days = (d: ByDay[]) => d.map((x) => {
    const wd = zh ? WD_ZH[x.weekday] : WD_EN[x.weekday]
    if (x.ordinal === undefined) return wd
    return zh ? `${ORD_ZH[x.ordinal]}${wd}` : `${ORD_EN[x.ordinal]} ${wd}`
  })
  const join = (xs: string[]) => (zh ? xs.join('、') : xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs.join(''))
  const mday = (d: number) => (zh ? (d === -1 ? '最后一天' : `${d} 日`) : d === -1 ? 'the last day' : `day ${d}`)
  let text: string
  switch (rule.freq) {
    case 'DAILY':
      text = zh ? (n === 1 ? '每天' : `每 ${n} 天`) : n === 1 ? 'every day' : `every ${n} days`
      break
    case 'WEEKLY':
      if (isWorkdays(rule.byDay) && n === 1) text = zh ? '每个工作日' : 'every weekday'
      else {
        const on = rule.byDay ? join(days(rule.byDay)) : ''
        text = zh ? `${n === 1 ? '每周' : `每 ${n} 周的`}${on}` : `${n === 1 ? 'every week' : `every ${n} weeks`}${on ? ` on ${on}` : ''}`
      }
      break
    case 'MONTHLY': {
      let on = ''
      if (rule.byMonthDay) on = join(rule.byMonthDay.map(mday))
      else if (rule.byDay && rule.bySetPos !== undefined) {
        on = isWorkdays(rule.byDay) ? (zh ? `${ORD_ZH[rule.bySetPos]}工作日` : `the ${ORD_EN[rule.bySetPos]} weekday`) : (zh ? `${ORD_ZH[rule.bySetPos]}${join(days(rule.byDay))}` : `the ${ORD_EN[rule.bySetPos]} of ${join(days(rule.byDay))}`)
      } else if (rule.byDay) on = zh ? join(days(rule.byDay)) : `the ${join(days(rule.byDay))}`
      text = zh ? `${n === 1 ? '每月' : `每 ${n} 个月的`}${on}` : `${n === 1 ? 'every month' : `every ${n} months`}${on ? ` on ${on}` : ''}`
      break
    }
    case 'YEARLY': {
      const months = rule.byMonth?.map((m) => (zh ? `${m} 月` : MONTH_EN[m - 1]))
      let on = months ? join(months) : ''
      if (rule.byMonthDay) on += zh ? join(rule.byMonthDay.map(mday)) : ` ${join(rule.byMonthDay.map((d) => (d === -1 ? 'last day' : String(d))))}`
      else if (rule.byDay) on += zh ? join(days(rule.byDay)) : ` on the ${join(days(rule.byDay))}`
      text = zh ? `${n === 1 ? '每年' : `每 ${n} 年的`}${on}` : `${n === 1 ? 'every year' : `every ${n} years`}${on.trim() ? ` in ${on.trim()}` : ''}`
      break
    }
  }
  if (rule.count !== undefined) text += zh ? `，共 ${rule.count} 次` : `, ${rule.count} times`
  if (rule.until !== undefined) text += zh ? `，到 ${rule.until.slice(0, 10)} 为止` : `, until ${rule.until.slice(0, 10)}`
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
  const zh = locale === 'zh'
  const w = WEEKDAYS[wd]
  const out: RecurrencePreset[] = [
    { id: 'none', label: zh ? '不重复' : 'Does not repeat', rrule: null },
    { id: 'daily', label: zh ? '每天' : 'Daily', rrule: 'FREQ=DAILY' },
    { id: 'weekdays', label: zh ? '每个工作日（周一至周五）' : 'Every weekday (Monday to Friday)', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
    { id: 'weekly', label: zh ? `每周的${WD_ZH[wd]}` : `Weekly on ${WD_EN[wd]}`, rrule: `FREQ=WEEKLY;BYDAY=${w}` },
    { id: 'monthly_day', label: zh ? `每月 ${d} 日` : `Monthly on day ${d}`, rrule: `FREQ=MONTHLY;BYMONTHDAY=${d}` },
  ]
  if (nth <= 4) out.push({ id: 'monthly_nth', label: zh ? `每月${ORD_ZH[nth]}${WD_ZH[wd]}` : `Monthly on the ${ORD_EN[nth]} ${WD_EN[wd]}`, rrule: `FREQ=MONTHLY;BYDAY=${nth}${w}` })
  if (last) out.push({ id: 'monthly_last', label: zh ? `每月最后一个${WD_ZH[wd]}` : `Monthly on the last ${WD_EN[wd]}`, rrule: `FREQ=MONTHLY;BYDAY=-1${w}` })
  out.push({ id: 'yearly', label: zh ? `每年 ${m} 月 ${d} 日` : `Annually on ${MONTH_EN[m - 1]} ${d}`, rrule: `FREQ=YEARLY;BYMONTH=${m};BYMONTHDAY=${d}` })
  return out
}
