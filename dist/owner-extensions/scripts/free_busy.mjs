const MSG_OBJECT_RESERVED_KEYS = [
  "from",
  "to",
  "kind",
  "to_session",
  "thread",
  "relates_to",
  "mentions",
  "workspace",
  "created_at_ms",
  "expires_at_ms",
  "nonce",
  "content",
  "proof"
];
new Set(MSG_OBJECT_RESERVED_KEYS.filter((key) => key !== "proof"));
typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8") : null;
class AiwsFailure extends Error {
  constructor(error) {
    super(`${error.code}${error.sub_code ? `/${error.sub_code}` : ""}: ${error.detail}`);
    this.name = "AiwsFailure";
    this.code = error.code;
    this.subCode = error.sub_code;
    this.data = error.data;
  }
}
new TextEncoder();
const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
class RRuleError extends Error {
  constructor(message) {
    super(message);
    this.name = "RRuleError";
  }
}
const FREQS = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];
const MAX_COUNT = 1e3;
const MAX_INTERVAL = 999;
function intIn(part, value, lo, hi, zero = false) {
  if (!/^[+-]?\d{1,3}$/.test(value))
    throw new RRuleError(`${part}: ${value} is not a number`);
  const n = Number(value);
  if (n < lo || n > hi || !zero && n === 0)
    throw new RRuleError(`${part}: ${value} is out of range`);
  return n;
}
function list(part, value, max) {
  const items = value.split(",");
  if (items.length === 0 || items.length > max || items.some((x) => x === ""))
    throw new RRuleError(`${part}: at most ${max} comma-separated values`);
  return items;
}
function untilOf(value) {
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (m) {
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    if (!isDate(date))
      throw new RRuleError(`UNTIL: ${value} is not a date`);
    return date;
  }
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (m) {
    const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    if (!isDate(`${m[1]}-${m[2]}-${m[3]}`) || +m[4] > 23 || +m[5] > 59 || +m[6] > 59)
      throw new RRuleError(`UNTIL: ${value} is not a UTC time`);
    return new Date(ms).toISOString();
  }
  throw new RRuleError(`UNTIL: ${value} must be YYYYMMDD or YYYYMMDDTHHMMSSZ`);
}
function parseRRule(text) {
  const body = text.startsWith("RRULE:") ? text.slice(6) : text;
  if (body.trim() === "")
    throw new RRuleError("empty rule");
  const seen = /* @__PURE__ */ new Set();
  const raw = {};
  for (const part of body.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0)
      throw new RRuleError(`${part || "(empty)"}: expected NAME=VALUE`);
    const name = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (name !== name.toUpperCase() || value !== value.toUpperCase())
      throw new RRuleError(`${part}: write the rule in upper case`);
    if (seen.has(name))
      throw new RRuleError(`${name}: given twice`);
    seen.add(name);
    if (!["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "BYMONTHDAY", "BYMONTH", "BYSETPOS", "WKST"].includes(name)) {
      throw new RRuleError(`${name}: not supported (supported: FREQ, INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY, BYMONTH, BYSETPOS, WKST)`);
    }
    if (value === "")
      throw new RRuleError(`${name}: empty value`);
    raw[name] = value;
  }
  if (!raw.FREQ)
    throw new RRuleError("FREQ is required");
  if (!FREQS.includes(raw.FREQ))
    throw new RRuleError(`FREQ: ${raw.FREQ} is not supported (DAILY, WEEKLY, MONTHLY, YEARLY)`);
  const freq = raw.FREQ;
  const rule = { freq, interval: 1, wkst: 0 };
  if (raw.INTERVAL !== void 0)
    rule.interval = intIn("INTERVAL", raw.INTERVAL, 1, MAX_INTERVAL);
  if (raw.COUNT !== void 0 && raw.UNTIL !== void 0)
    throw new RRuleError("COUNT and UNTIL cannot both be given");
  if (raw.COUNT !== void 0)
    rule.count = intIn("COUNT", raw.COUNT, 1, MAX_COUNT);
  if (raw.UNTIL !== void 0)
    rule.until = untilOf(raw.UNTIL);
  if (raw.BYDAY !== void 0) {
    rule.byDay = list("BYDAY", raw.BYDAY, 7).map((item) => {
      const m = /^([+-]?\d)?(MO|TU|WE|TH|FR|SA|SU)$/.exec(item);
      if (!m)
        throw new RRuleError(`BYDAY: ${item} is not a weekday`);
      const weekday = WEEKDAYS.indexOf(m[2]);
      if (m[1] === void 0)
        return { weekday };
      if (freq !== "MONTHLY" && freq !== "YEARLY")
        throw new RRuleError(`BYDAY: ${item}: an ordinal needs FREQ=MONTHLY or YEARLY`);
      return { weekday, ordinal: intIn("BYDAY", m[1], -5, 5) };
    });
    const keys = rule.byDay.map((d) => `${d.ordinal ?? ""}${d.weekday}`);
    if (new Set(keys).size !== keys.length)
      throw new RRuleError("BYDAY: repeated day");
  }
  if (raw.BYMONTHDAY !== void 0) {
    if (freq !== "MONTHLY" && freq !== "YEARLY")
      throw new RRuleError("BYMONTHDAY needs FREQ=MONTHLY or YEARLY");
    rule.byMonthDay = list("BYMONTHDAY", raw.BYMONTHDAY, 31).map((v) => {
      const n = intIn("BYMONTHDAY", v, -1, 31);
      return n;
    });
    if (new Set(rule.byMonthDay).size !== rule.byMonthDay.length)
      throw new RRuleError("BYMONTHDAY: repeated day");
  }
  if (raw.BYMONTH !== void 0) {
    if (freq !== "YEARLY")
      throw new RRuleError("BYMONTH needs FREQ=YEARLY");
    rule.byMonth = list("BYMONTH", raw.BYMONTH, 12).map((v) => intIn("BYMONTH", v, 1, 12));
    if (new Set(rule.byMonth).size !== rule.byMonth.length)
      throw new RRuleError("BYMONTH: repeated month");
  }
  if (raw.BYSETPOS !== void 0) {
    if (freq !== "MONTHLY" || !rule.byDay)
      throw new RRuleError("BYSETPOS needs FREQ=MONTHLY and BYDAY");
    rule.bySetPos = intIn("BYSETPOS", raw.BYSETPOS, -5, 5);
  }
  if (raw.WKST !== void 0) {
    const w = WEEKDAYS.indexOf(raw.WKST);
    if (w < 0)
      throw new RRuleError(`WKST: ${raw.WKST} is not a weekday`);
    rule.wkst = w;
  }
  return rule;
}
function isDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m)
    return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  return y >= 1 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}
const isLeap = (y) => y % 4 === 0 && y % 100 !== 0 || y % 400 === 0;
function daysInMonth(y, m) {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}
const dayNumber = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 864e5);
function dayOf(date) {
  return dayNumber(+date.slice(0, 4), +date.slice(5, 7), +date.slice(8, 10));
}
function dateOf(day) {
  return new Date(day * 864e5).toISOString().slice(0, 10);
}
function ymdOf(day) {
  const t = new Date(day * 864e5);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
const weekdayOf = (day) => ((day + 3) % 7 + 7) % 7;
const formatters = /* @__PURE__ */ new Map();
function formatter(tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    formatters.set(tz, f);
  }
  return f;
}
function isTimeZone(tz) {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}
function zonedParts(ms, tz) {
  const parts = {};
  for (const p of formatter(tz).formatToParts(new Date(ms)))
    if (p.type !== "literal")
      parts[p.type] = Number(p.value);
  return { y: parts.year, m: parts.month, d: parts.day, h: parts.hour === 24 ? 0 : parts.hour, mi: parts.minute, s: parts.second };
}
function offsetMs(ms, tz) {
  const p = zonedParts(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1e3) * 1e3;
}
function zonedToUtc(day, minuteOfDay, secondOfMinute, tz) {
  const local = day * 864e5 + minuteOfDay * 6e4 + secondOfMinute * 1e3;
  const first = local - offsetMs(local, tz);
  const second = local - offsetMs(first, tz);
  return second !== first && local - offsetMs(second, tz) !== second ? Math.max(first, second) : second;
}
function localDay(ms, tz) {
  const p = zonedParts(ms, tz);
  return dayNumber(p.y, p.m, p.d);
}
const MAX_PERIODS = 2e5;
function candidates(rule, period, startDay) {
  const s = ymdOf(startDay);
  const out = [];
  const byDayAll = (day0, len, wanted) => {
    for (let i = 0; i < len; i++)
      if (wanted.some((w) => w.ordinal === void 0 && w.weekday === weekdayOf(day0 + i)))
        out.push(day0 + i);
  };
  const nth = (day0, len, w) => {
    const days = [];
    for (let i = 0; i < len; i++)
      if (weekdayOf(day0 + i) === w.weekday)
        days.push(day0 + i);
    const k = w.ordinal > 0 ? w.ordinal - 1 : days.length + w.ordinal;
    if (k >= 0 && k < days.length)
      out.push(days[k]);
  };
  const monthDays = (y, m, list2) => {
    const n = daysInMonth(y, m);
    for (const d of list2) {
      const day = d > 0 ? d : n + d + 1;
      if (day >= 1 && day <= n)
        out.push(dayNumber(y, m, day));
    }
  };
  switch (rule.freq) {
    case "DAILY": {
      const day = startDay + period * rule.interval;
      const { m, d } = ymdOf(day);
      if (rule.byMonth && !rule.byMonth.includes(m))
        break;
      if (rule.byMonthDay && !rule.byMonthDay.some((x) => x > 0 ? x === d : daysInMonth(ymdOf(day).y, m) + x + 1 === d))
        break;
      if (rule.byDay && !rule.byDay.some((w) => w.weekday === weekdayOf(day)))
        break;
      out.push(day);
      break;
    }
    case "WEEKLY": {
      const weekStart = startDay - (weekdayOf(startDay) - rule.wkst + 7) % 7 + period * rule.interval * 7;
      const wanted = rule.byDay ?? [{ weekday: weekdayOf(startDay) }];
      byDayAll(weekStart, 7, wanted);
      if (rule.byMonth)
        return out.filter((d) => rule.byMonth.includes(ymdOf(d).m)).sort((a, b) => a - b);
      break;
    }
    case "MONTHLY": {
      const index = s.y * 12 + (s.m - 1) + period * rule.interval;
      const y = Math.floor(index / 12), m = index % 12 + 1;
      const day0 = dayNumber(y, m, 1), len = daysInMonth(y, m);
      if (rule.byMonthDay) {
        monthDays(y, m, rule.byMonthDay);
        if (rule.byDay) {
          const keep = out.filter((d) => rule.byDay.some((w) => w.weekday === weekdayOf(d)));
          out.length = 0;
          out.push(...keep);
        }
      } else if (rule.byDay) {
        byDayAll(day0, len, rule.byDay);
        for (const w of rule.byDay)
          if (w.ordinal !== void 0)
            nth(day0, len, w);
      } else if (s.d <= len)
        out.push(dayNumber(y, m, s.d));
      break;
    }
    case "YEARLY": {
      const y = s.y + period * rule.interval;
      if (rule.byDay && !rule.byMonth && !rule.byMonthDay) {
        const day0 = dayNumber(y, 1, 1), len = isLeap(y) ? 366 : 365;
        byDayAll(day0, len, rule.byDay);
        for (const w of rule.byDay)
          if (w.ordinal !== void 0)
            nth(day0, len, w);
        break;
      }
      const months = rule.byMonth ?? [s.m];
      for (const m of months) {
        if (rule.byMonthDay)
          monthDays(y, m, rule.byMonthDay);
        else if (rule.byDay) {
          const day0 = dayNumber(y, m, 1), len = daysInMonth(y, m);
          byDayAll(day0, len, rule.byDay);
          for (const w of rule.byDay)
            if (w.ordinal !== void 0)
              nth(day0, len, w);
        } else if (s.d <= daysInMonth(y, m))
          out.push(dayNumber(y, m, s.d));
      }
      if (rule.byMonthDay && rule.byDay) {
        const keep = out.filter((d) => rule.byDay.some((w) => w.weekday === weekdayOf(d)));
        out.length = 0;
        out.push(...keep);
      }
      break;
    }
  }
  const sorted = [...new Set(out)].sort((a, b) => a - b);
  if (rule.bySetPos !== void 0) {
    const k = rule.bySetPos > 0 ? rule.bySetPos - 1 : sorted.length + rule.bySetPos;
    return k >= 0 && k < sorted.length ? [sorted[k]] : [];
  }
  return sorted;
}
function periodStart(rule, p, startDay) {
  const s = ymdOf(startDay);
  switch (rule.freq) {
    case "DAILY":
      return startDay + p * rule.interval;
    case "WEEKLY":
      return startDay - (weekdayOf(startDay) - rule.wkst + 7) % 7 + p * rule.interval * 7;
    case "MONTHLY": {
      const index = s.y * 12 + (s.m - 1) + p * rule.interval;
      return dayNumber(Math.floor(index / 12), index % 12 + 1, 1);
    }
    case "YEARLY":
      return dayNumber(s.y + p * rule.interval, 1, 1);
  }
}
function periodsBefore(rule, startDay, day) {
  const s = ymdOf(startDay);
  const t = ymdOf(day);
  let p;
  switch (rule.freq) {
    case "DAILY":
      p = Math.floor((day - startDay) / rule.interval);
      break;
    case "WEEKLY":
      p = Math.floor((day - periodStart(rule, 0, startDay)) / (7 * rule.interval));
      break;
    case "MONTHLY":
      p = Math.floor((t.y * 12 + t.m - (s.y * 12 + s.m)) / rule.interval);
      break;
    case "YEARLY":
      p = Math.floor((t.y - s.y) / rule.interval);
      break;
  }
  return Math.max(-1, p - 1);
}
function expandSeries(rule, start, window, opts = {}) {
  const limit = opts.limit ?? 2e3;
  const excluded = new Set(opts.exdate ?? []);
  const out = [];
  let startDay;
  let minute = 0, second = 0;
  let tz = "UTC";
  let fromDay, toDay;
  const viewerTz = opts.viewerTz ?? "UTC";
  if (start.kind === "date") {
    startDay = dayOf(start.date);
    fromDay = localDay(window.fromMs, viewerTz) - (opts.durationDays ?? 0);
    toDay = localDay(window.toMs - 1, viewerTz);
  } else {
    tz = start.tz;
    const ms = Date.parse(start.utc);
    const p = zonedParts(ms, tz);
    startDay = dayNumber(p.y, p.m, p.d);
    minute = p.h * 60 + p.mi;
    second = p.s;
    fromDay = localDay(window.fromMs - (opts.durationMs ?? 0), tz) - 1;
    toDay = localDay(window.toMs, tz) + 1;
  }
  const untilDay = rule.until?.length === 10 ? dayOf(rule.until) : void 0;
  const untilMs = rule.until && rule.until.length > 10 ? Date.parse(rule.until) : void 0;
  let count = 0;
  const emit = (day) => {
    if (rule.count !== void 0 && count >= rule.count)
      return false;
    if (untilDay !== void 0 && day > untilDay)
      return false;
    let occ;
    if (start.kind === "date") {
      if (untilMs !== void 0 && day * 864e5 > untilMs)
        return false;
      const date = dateOf(day);
      occ = { original: date, date };
    } else {
      const firstMs = Date.parse(start.utc);
      const ms = day === startDay ? firstMs : zonedToUtc(day, minute, second, tz) + new Date(firstMs).getUTCMilliseconds();
      if (untilMs !== void 0 && ms > untilMs)
        return false;
      occ = { original: new Date(ms).toISOString(), startMs: ms };
    }
    count += 1;
    if (excluded.has(occ.original))
      return true;
    if (start.kind === "date") {
      if (day >= fromDay && day <= toDay)
        out.push(occ);
    } else if (occ.startMs + (opts.durationMs ?? 0) > window.fromMs && occ.startMs < window.toMs)
      out.push(occ);
    return true;
  };
  if (startDay > toDay || !emit(startDay))
    return out;
  let period = rule.count === void 0 ? periodsBefore(rule, startDay, fromDay) + 1 : 0;
  for (let guard = 0; guard < MAX_PERIODS && out.length < limit; guard++, period++) {
    if (periodStart(rule, period, startDay) > toDay)
      return out;
    for (const day of candidates(rule, period, startDay)) {
      if (day <= startDay)
        continue;
      if (day > toDay)
        return out;
      if (!emit(day))
        return out;
      if (out.length >= limit) {
        opts.onTruncated?.();
        return out;
      }
    }
  }
  if (periodStart(rule, period, startDay) <= toDay)
    opts.onTruncated?.();
  return out;
}
function seriesStartOf(values, tz, fallbackTz = "UTC") {
  if (values.all_day === true)
    return typeof values.start_date === "string" ? { kind: "date", date: values.start_date } : null;
  return typeof values.start === "string" ? { kind: "datetime", utc: values.start, tz: tz && isTimeZone(tz) ? tz : fallbackTz } : null;
}
function occurrenceId(recordId, original) {
  return `${recordId}@${original}`;
}
function canonicalOriginal(x) {
  if (isDate(x))
    return x;
  const t = Date.parse(x);
  return Number.isFinite(t) ? new Date(t).toISOString() : x;
}
const originals = (v) => Array.isArray(v) ? v.filter((x) => typeof x === "string").map(canonicalOriginal) : [];
const extOf = (row) => {
  const e = row?.values.ext;
  return e && typeof e === "object" && !Array.isArray(e) ? { ...e } : {};
};
const DEFAULT_EVENT_MS = 36e5;
function rowTimes(row) {
  const v = row.values;
  if (v.all_day === true) {
    if (typeof v.start_date !== "string" || !isDate(v.start_date))
      return null;
    const endDate = typeof v.end_date === "string" && isDate(v.end_date) && v.end_date >= v.start_date ? v.end_date : v.start_date;
    return { allDay: true, startDate: v.start_date, endDate };
  }
  if (typeof v.start !== "string")
    return null;
  const startMs = Date.parse(v.start);
  if (!Number.isFinite(startMs))
    return null;
  const end = typeof v.end === "string" ? Date.parse(v.end) : NaN;
  return { allDay: false, startMs, endMs: Number.isFinite(end) && end >= startMs ? end : startMs + DEFAULT_EVENT_MS };
}
function addDays(date, n) {
  return dateOf(dayOf(date) + n);
}
const daysBetween = (a, b) => dayOf(b) - dayOf(a);
function occurrenceOf(row, times, extra) {
  const ext = extOf(row);
  return {
    id: row.record_id,
    row,
    title: typeof row.values.title === "string" ? row.values.title : "",
    allDay: times.allDay,
    startMs: times.startMs,
    endMs: times.endMs,
    startDate: times.startDate,
    endDate: times.endDate,
    status: typeof row.values.status === "string" ? row.values.status : null,
    ext,
    recurring: false,
    override: false,
    agentWritten: false,
    ...extra
  };
}
function overlaps(o, window, viewerTz) {
  if (!o.allDay)
    return o.startMs < window.toMs && Math.max(o.endMs, o.startMs + 1) > window.fromMs;
  const from = localDate(window.fromMs, viewerTz), to = localDate(window.toMs - 1, viewerTz);
  return o.startDate <= to && o.endDate >= from;
}
function localDate(ms, tz) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  return f.format(new Date(ms));
}
function viewerTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
function calendarOccurrences(rows, window, opts = {}) {
  const viewerTz = opts.viewerTz ?? viewerTimeZone();
  const out = [];
  const overrides = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const rid = extOf(row).recurrence_id;
    if (rid && typeof rid === "object" && !Array.isArray(rid) && typeof rid.master === "string" && typeof rid.original === "string")
      overrides.set(`${rid.master}@${canonicalOriginal(rid.original)}`, row);
  }
  const byId = new Map(rows.map((r) => [r.record_id, r]));
  for (const row of rows) {
    const times = rowTimes(row);
    if (!times)
      continue;
    const ext = extOf(row);
    const rid = ext.recurrence_id;
    if (rid && typeof rid === "object") {
      const master = typeof rid.master === "string" ? byId.get(rid.master) : void 0;
      const original = typeof rid.original === "string" ? canonicalOriginal(rid.original) : void 0;
      const occ2 = occurrenceOf(row, times, { id: master && original ? occurrenceId(master.record_id, original) : row.record_id, master, original, recurring: Boolean(master), override: true });
      if (overlaps(occ2, window, viewerTz))
        out.push(occ2);
      continue;
    }
    const duration = times.allDay ? daysBetween(times.startDate, times.endDate) : times.endMs - times.startMs;
    const shift = (o) => {
      const key = `${row.record_id}@${o.original}`;
      if (overrides.has(key))
        return null;
      if (times.allDay)
        return occurrenceOf(row, { allDay: true, startDate: o.date, endDate: addDays(o.date, duration) }, { id: key, master: row, original: o.original, recurring: true });
      return occurrenceOf(row, { allDay: false, startMs: o.startMs, endMs: o.startMs + duration }, { id: key, master: row, original: o.original, recurring: true });
    };
    let rule = null;
    if (typeof ext.rrule === "string") {
      try {
        rule = parseRRule(ext.rrule);
      } catch {
        rule = null;
      }
    }
    if (rule) {
      const start = seriesStartOf(row.values, typeof ext.tz === "string" ? ext.tz : void 0, viewerTz);
      if (!start)
        continue;
      const exdate = originals(ext.exdate);
      const occs = expandSeries(rule, start, window, { exdate, viewerTz, durationMs: times.allDay ? void 0 : duration, durationDays: times.allDay ? duration : void 0, limit: opts.limit, onTruncated: opts.onTruncated });
      for (const o of occs) {
        const s = shift(o);
        if (s)
          out.push(s);
      }
      continue;
    }
    if (Array.isArray(ext.occurrences) && ext.occurrences.length > 0) {
      const exdate = new Set(originals(ext.exdate));
      for (const raw of ext.occurrences) {
        if (typeof raw !== "string")
          continue;
        const x = canonicalOriginal(raw);
        if (exdate.has(x))
          continue;
        const o = times.allDay ? { original: x, date: x } : { original: x, startMs: Date.parse(x) };
        if (!times.allDay && !Number.isFinite(o.startMs))
          continue;
        if (times.allDay && !isDate(x))
          continue;
        const s = shift(o);
        if (s && overlaps(s, window, viewerTz))
          out.push({ ...s, agentWritten: true });
      }
      continue;
    }
    const occ = occurrenceOf(row, times, {});
    if (overlaps(occ, window, viewerTz))
      out.push(occ);
  }
  return out.sort((a, b) => sortKey(a) - sortKey(b) || a.id.localeCompare(b.id));
}
const sortKey = (o) => o.allDay ? Date.parse(`${o.startDate}T00:00:00Z`) : o.startMs;
function invalid(message) {
  throw new AiwsFailure({ code: "INVALID_ARGUMENT", detail: message, retryable: false });
}
function instant(value, field) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value) || !isDate(value.slice(0, 10)) || !Number.isFinite(Date.parse(value)))
    invalid(`${field} requires an RFC 3339 instant with offset`);
  return Date.parse(value);
}
function freeBusy(input2) {
  const fromMs = instant(input2.from, "from"), toMs = instant(input2.to, "to");
  if (toMs <= fromMs || toMs - fromMs > 366 * 864e5)
    throw new Error("invalid free_busy window");
  if (!Array.isArray(input2.rows))
    throw new Error("missing calendar rows");
  const zone = input2.tz && isTimeZone(input2.tz) ? input2.tz : void 0;
  let complete = !input2.truncated;
  const rows = [];
  for (const row of input2.rows) {
    try {
      if (!row.record_id || !row.values)
        throw new Error();
      const v = row.values;
      if (v.status === "cancelled" && !v.ext)
        continue;
      if (v.all_day === true) {
        if (!zone || typeof v.start_date !== "string" || !isDate(v.start_date) || v.end_date != null && (typeof v.end_date !== "string" || !isDate(v.end_date) || v.end_date < v.start_date))
          throw new Error();
      } else {
        const start = instant(v.start, "start");
        if (v.end != null && instant(v.end, "end") < start)
          throw new Error();
      }
      if (v.ext != null && (typeof v.ext !== "object" || Array.isArray(v.ext)))
        throw new Error();
      const ext = v.ext ?? {};
      if (ext.rrule !== void 0) {
        if (typeof ext.rrule !== "string" || ext.tz !== void 0 && (typeof ext.tz !== "string" || !isTimeZone(ext.tz)) || !zone && !ext.tz && v.all_day !== true)
          throw new Error();
        parseRRule(ext.rrule);
      }
      if (ext.rule_text || ext.occurrences)
        complete = false;
      if (ext.exdate !== void 0 && (!Array.isArray(ext.exdate) || !ext.exdate.every((x) => typeof x === "string" && (v.all_day === true ? isDate(x) : Number.isFinite(instant(x, "exdate"))))))
        throw new Error();
      if (ext.recurrence_id !== void 0) {
        const rid = ext.recurrence_id;
        if (!rid || typeof rid.master !== "string" || typeof rid.original !== "string" || !isDate(rid.original) && !Number.isFinite(instant(rid.original, "original")))
          throw new Error();
      }
      rows.push(row);
    } catch {
      complete = false;
    }
  }
  const spans = [];
  const events = calendarOccurrences(rows, { fromMs, toMs }, { viewerTz: zone ?? "UTC", limit: 2e3, onTruncated: () => {
    complete = false;
  } });
  for (const event of events) {
    if (event.status === "cancelled")
      continue;
    const start = event.allDay ? zonedToUtc(dayOf(event.startDate), 0, 0, zone) : event.startMs;
    const end = event.allDay ? zonedToUtc(dayOf(event.endDate) + 1, 0, 0, zone) : event.endMs;
    if (end > fromMs && start < toMs && end > start)
      spans.push([Math.max(start, fromMs), Math.min(end, toMs)]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && last[1] >= span[0])
      last[1] = Math.max(last[1], span[1]);
    else
      merged.push(span);
  }
  return { intervals: merged.map(([a, b]) => ({ start: new Date(a).toISOString(), end: new Date(b).toISOString() })), coverage: complete ? "complete" : "partial" };
}
const input = await new Response(Deno.stdin.readable).json();
console.log(JSON.stringify(freeBusy(input)));
