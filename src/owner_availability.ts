import { calendarOccurrences, type RowLike } from './aiws_schedule'
import { dayOf, isDate, isTimeZone, parseRRule, zonedToUtc } from './aiws_rrule'
import { instant } from './owner_schedule'

export function freeBusy(input: { rows: RowLike[]; from: string; to: string; tz?: string; truncated?: boolean }) {
  const fromMs = instant(input.from, 'from'), toMs = instant(input.to, 'to')
  if (toMs <= fromMs || toMs - fromMs > 366 * 86400000) throw new Error('invalid free_busy window')
  if (!Array.isArray(input.rows)) throw new Error('missing calendar rows')
  const zone = input.tz && isTimeZone(input.tz) ? input.tz : undefined
  let complete = !input.truncated
  const rows: RowLike[] = []
  for (const row of input.rows) {
    try {
      if (!row.record_id || !row.values) throw new Error()
      const v = row.values
      if (v.status === 'cancelled' && !v.ext) continue
      if (v.all_day === true) {
        if (!zone || typeof v.start_date !== 'string' || !isDate(v.start_date) ||
            (v.end_date != null && (typeof v.end_date !== 'string' || !isDate(v.end_date) || v.end_date < v.start_date))) throw new Error()
      } else {
        const start = instant(v.start, 'start')
        if (v.end != null && instant(v.end, 'end') < start) throw new Error()
      }
      if (v.ext != null && (typeof v.ext !== 'object' || Array.isArray(v.ext))) throw new Error()
      const ext = (v.ext ?? {}) as Record<string, unknown>
      if (ext.rrule !== undefined) {
        if (typeof ext.rrule !== 'string' || (ext.tz !== undefined && (typeof ext.tz !== 'string' || !isTimeZone(ext.tz))) ||
            (!zone && !ext.tz && v.all_day !== true)) throw new Error()
        parseRRule(ext.rrule)
      }
      if (ext.rule_text || ext.occurrences) complete = false
      if (ext.exdate !== undefined && (!Array.isArray(ext.exdate) || !ext.exdate.every((x) => typeof x === 'string' && (v.all_day === true ? isDate(x) : Number.isFinite(instant(x, 'exdate')))))) throw new Error()
      if (ext.recurrence_id !== undefined) {
        const rid = ext.recurrence_id as { master?: string; original?: string } | null
        if (!rid || typeof rid.master !== 'string' || typeof rid.original !== 'string' ||
          (!isDate(rid.original) && !Number.isFinite(instant(rid.original, 'original')))) throw new Error()
      }
      rows.push(row)
    } catch { complete = false }
  }
  const spans: [number, number][] = []
  const events = calendarOccurrences(rows, { fromMs, toMs }, { viewerTz: zone ?? 'UTC', limit: 2000, onTruncated: () => { complete = false } })
  for (const event of events) {
    if (event.status === 'cancelled') continue
    const start = event.allDay ? zonedToUtc(dayOf(event.startDate!), 0, 0, zone!) : event.startMs!
    const end = event.allDay ? zonedToUtc(dayOf(event.endDate!) + 1, 0, 0, zone!) : event.endMs!
    if (end > fromMs && start < toMs && end > start) spans.push([Math.max(start, fromMs), Math.min(end, toMs)])
  }
  spans.sort((a,b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const span of spans) {
    const last = merged[merged.length - 1]
    if (last && last[1] >= span[0]) last[1] = Math.max(last[1], span[1])
    else merged.push(span)
  }
  return { intervals: merged.map(([a,b]) => ({ start: new Date(a).toISOString(), end: new Date(b).toISOString() })), coverage: complete ? 'complete' : 'partial' }
}
