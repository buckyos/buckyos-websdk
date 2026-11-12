import { describeRRule, expandSeries, formatRRule, occurrenceId, parseOccurrenceId, parseRRule, recurrencePresets, RRuleError, zonedToUtc, dayOf } from '../src/aiws_rrule'

const ms = (iso: string) => Date.parse(iso)
const win = (from: string, to: string) => ({ fromMs: ms(from), toMs: ms(to) })
const dates = (occ: { date?: string; startMs?: number }[]) => occ.map((o) => o.date ?? new Date(o.startMs!).toISOString())

describe('RRULE subset: parse and format', () => {
  it('accepts the choices of a mainstream calendar and writes them back', () => {
    for (const text of [
      'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'FREQ=MONTHLY;BYDAY=-1FR', 'FREQ=MONTHLY;BYMONTHDAY=15;COUNT=10',
      'FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=8', 'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', 'FREQ=DAILY;INTERVAL=2;UNTIL=20261231T000000Z',
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20270101',
    ]) expect(formatRRule(parseRRule(text))).toBe(text)
  })
  it('refuses what is outside the subset, naming the part', () => {
    const refused: [string, RegExp][] = [
      ['FREQ=HOURLY', /FREQ/], ['FREQ=DAILY;BYHOUR=9', /BYHOUR/], ['FREQ=DAILY;COUNT=2;UNTIL=20261231', /COUNT and UNTIL/],
      ['FREQ=WEEKLY;BYDAY=1MO', /ordinal/], ['freq=daily', /upper case/], ['FREQ=DAILY;FREQ=WEEKLY', /twice/],
      ['FREQ=WEEKLY;BYMONTHDAY=3', /BYMONTHDAY/], ['FREQ=MONTHLY;BYSETPOS=1', /BYSETPOS/], ['FREQ=DAILY;INTERVAL=0', /INTERVAL/],
      ['FREQ=MONTHLY;BYMONTHDAY=32', /BYMONTHDAY/], ['FREQ=DAILY;UNTIL=20260231', /UNTIL/], ['', /empty/],
    ]
    for (const [text, why] of refused) {
      expect(() => parseRRule(text)).toThrow(RRuleError)
      expect(() => parseRRule(text)).toThrow(why)
    }
  })
})

describe('RRULE subset: expansion', () => {
  it('every weekday at 09:00 in Shanghai', () => {
    const rule = parseRRule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')
    const occ = expandSeries(rule, { kind: 'datetime', utc: '2026-11-09T01:00:00.000Z', tz: 'Asia/Shanghai' }, win('2026-11-09T00:00:00Z', '2026-11-23T00:00:00Z'))
    expect(occ).toHaveLength(10)
    expect(dates(occ).slice(0, 6)).toEqual([
      '2026-11-09T01:00:00.000Z', '2026-11-10T01:00:00.000Z', '2026-11-11T01:00:00.000Z', '2026-11-12T01:00:00.000Z', '2026-11-13T01:00:00.000Z', '2026-11-16T01:00:00.000Z',
    ])
    expect(occ[0].original).toBe('2026-11-09T01:00:00.000Z')
  })
  it('the last Friday of every month', () => {
    const occ = expandSeries(parseRRule('FREQ=MONTHLY;BYDAY=-1FR'), { kind: 'date', date: '2026-11-27' }, win('2026-11-01T00:00:00Z', '2027-02-01T00:00:00Z'))
    expect(dates(occ)).toEqual(['2026-11-27', '2026-12-25', '2027-01-29'])
  })
  it('the last weekday of every month (BYSETPOS)', () => {
    const occ = expandSeries(parseRRule('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1'), { kind: 'date', date: '2026-11-30' }, win('2026-11-01T00:00:00Z', '2027-03-01T00:00:00Z'))
    expect(dates(occ)).toEqual(['2026-11-30', '2026-12-31', '2027-01-29', '2027-02-26'])
  })
  it('day 31 skips the months without one', () => {
    const occ = expandSeries(parseRRule('FREQ=MONTHLY;BYMONTHDAY=31'), { kind: 'date', date: '2026-10-31' }, win('2026-10-01T00:00:00Z', '2027-04-01T00:00:00Z'))
    expect(dates(occ)).toEqual(['2026-10-31', '2026-12-31', '2027-01-31', '2027-03-31'])
  })
  it('COUNT counts excluded occurrences; UNTIL is inclusive', () => {
    const daily = { kind: 'date' as const, date: '2026-11-01' }
    const counted = expandSeries(parseRRule('FREQ=DAILY;COUNT=5'), daily, win('2026-10-01T00:00:00Z', '2027-01-01T00:00:00Z'), { exdate: ['2026-11-02'] })
    expect(dates(counted)).toEqual(['2026-11-01', '2026-11-03', '2026-11-04', '2026-11-05'])
    const until = expandSeries(parseRRule('FREQ=DAILY;UNTIL=20261103'), daily, win('2026-10-01T00:00:00Z', '2027-01-01T00:00:00Z'))
    expect(dates(until)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03'])
  })
  it('keeps the wall clock across a clock change', () => {
    // New York leaves daylight saving time on 2026-11-01
    const occ = expandSeries(parseRRule('FREQ=WEEKLY'), { kind: 'datetime', utc: '2026-10-26T13:00:00.000Z', tz: 'America/New_York' }, win('2026-10-20T00:00:00Z', '2026-11-10T00:00:00Z'))
    expect(dates(occ)).toEqual(['2026-10-26T13:00:00.000Z', '2026-11-02T14:00:00.000Z', '2026-11-09T14:00:00.000Z'])
  })
  it('February 29 only in leap years', () => {
    const occ = expandSeries(parseRRule('FREQ=YEARLY'), { kind: 'date', date: '2024-02-29' }, win('2024-01-01T00:00:00Z', '2033-01-01T00:00:00Z'))
    expect(dates(occ)).toEqual(['2024-02-29', '2028-02-29', '2032-02-29'])
  })
  it('every other week on Monday and Wednesday', () => {
    const occ = expandSeries(parseRRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE'), { kind: 'date', date: '2026-11-02' }, win('2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z'))
    expect(dates(occ)).toEqual(['2026-11-02', '2026-11-04', '2026-11-16', '2026-11-18', '2026-11-30'])
  })
  it('a window far after the start is reached without walking every period', () => {
    const occ = expandSeries(parseRRule('FREQ=DAILY'), { kind: 'datetime', utc: '2000-01-01T08:00:00.000Z', tz: 'UTC' }, win('2026-11-10T00:00:00Z', '2026-11-13T00:00:00Z'))
    expect(dates(occ)).toEqual(['2026-11-10T08:00:00.000Z', '2026-11-11T08:00:00.000Z', '2026-11-12T08:00:00.000Z'])
  })
  it('an occurrence that started before the window but overlaps it is kept', () => {
    const occ = expandSeries(parseRRule('FREQ=DAILY'), { kind: 'datetime', utc: '2026-11-01T23:00:00.000Z', tz: 'UTC' }, win('2026-11-03T00:00:00Z', '2026-11-04T00:00:00Z'), { durationMs: 2 * 3600_000 })
    expect(dates(occ)).toEqual(['2026-11-02T23:00:00.000Z', '2026-11-03T23:00:00.000Z'])
  })
  it('a zoned wall clock to an instant', () => {
    expect(new Date(zonedToUtc(dayOf('2026-07-01'), 9 * 60, 0, 'Europe/Berlin')).toISOString()).toBe('2026-07-01T07:00:00.000Z')
  })
})

describe('RRULE subset: words', () => {
  it('describes rules as a person would say them', () => {
    expect(describeRRule(parseRRule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'))).toBe('每个工作日')
    expect(describeRRule(parseRRule('FREQ=MONTHLY;BYDAY=-1FR'))).toBe('每月最后一个周五')
    expect(describeRRule(parseRRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=6'), 'en')).toBe('every 2 weeks on Monday and Wednesday, 6 times')
    expect(describeRRule(parseRRule('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1'))).toBe('每月最后一个工作日')
  })
  it('offers the presets of a repeat menu for a date', () => {
    const presets = recurrencePresets('2026-11-27')
    expect(presets.map((p) => p.id)).toEqual(['none', 'daily', 'weekdays', 'weekly', 'monthly_day', 'monthly_nth', 'monthly_last', 'yearly'])
    expect(presets.find((p) => p.id === 'monthly_last')?.rrule).toBe('FREQ=MONTHLY;BYDAY=-1FR')
    for (const p of presets) if (p.rrule) expect(() => parseRRule(p.rrule!)).not.toThrow()
  })
  it('occurrence ids keep the series and the original apart', () => {
    const id = occurrenceId('r1', '2026-11-09T01:00:00.000Z')
    expect(parseOccurrenceId(id)).toEqual({ recordId: 'r1', original: '2026-11-09T01:00:00.000Z' })
    expect(parseOccurrenceId('r1')).toEqual({ recordId: 'r1', original: null })
  })
})
