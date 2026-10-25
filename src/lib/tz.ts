// Time zone helpers (pure, tested). Candles are stored as UTC unix seconds; a time zone only changes how the chart shows them.

/** One city per time zone, west to east by standard offset. */
export const ZONES: { id: string; city: string }[] = [
  { id: 'Pacific/Pago_Pago', city: 'Pago Pago, American Samoa' },
  { id: 'Pacific/Honolulu', city: 'Honolulu, USA' },
  { id: 'America/Anchorage', city: 'Anchorage, USA' },
  { id: 'America/Los_Angeles', city: 'Los Angeles, USA' },
  { id: 'America/Denver', city: 'Denver, USA' },
  { id: 'America/Chicago', city: 'Chicago, USA' },
  { id: 'America/New_York', city: 'New York, USA' },
  { id: 'America/Halifax', city: 'Halifax, Canada' },
  { id: 'America/St_Johns', city: "St. John's, Canada" },
  { id: 'America/Sao_Paulo', city: 'Brasilia, Brazil' },
  { id: 'Atlantic/South_Georgia', city: 'Grytviken, South Georgia' },
  { id: 'Atlantic/Azores', city: 'Ponta Delgada, Azores' },
  { id: 'Europe/London', city: 'London, United Kingdom' },
  { id: 'Europe/Berlin', city: 'Berlin, Germany' },
  { id: 'Europe/Athens', city: 'Athens, Greece' },
  { id: 'Europe/Moscow', city: 'Moscow, Russia' },
  { id: 'Asia/Tehran', city: 'Tehran, Iran' },
  { id: 'Asia/Dubai', city: 'Abu Dhabi, UAE' },
  { id: 'Asia/Kabul', city: 'Kabul, Afghanistan' },
  { id: 'Asia/Karachi', city: 'Islamabad, Pakistan' },
  { id: 'Asia/Kolkata', city: 'New Delhi, India' },
  { id: 'Asia/Kathmandu', city: 'Kathmandu, Nepal' },
  { id: 'Asia/Dhaka', city: 'Dhaka, Bangladesh' },
  { id: 'Asia/Yangon', city: 'Naypyidaw, Myanmar' },
  { id: 'Asia/Bangkok', city: 'Bangkok, Thailand' },
  { id: 'Asia/Shanghai', city: 'Beijing, China' },
  { id: 'Asia/Tokyo', city: 'Tokyo, Japan' },
  { id: 'Australia/Adelaide', city: 'Adelaide, Australia' },
  { id: 'Australia/Sydney', city: 'Canberra, Australia' },
  { id: 'Pacific/Noumea', city: 'Honiara, Solomon Islands' },
  { id: 'Pacific/Auckland', city: 'Wellington, New Zealand' },
  { id: 'Pacific/Tongatapu', city: "Nuku'alofa, Tonga" },
];

export const systemTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };

let setting = 'system';
/** Zone the chart shows ('system' = the computer's own). */
export function setZone(id: string) { setting = id || 'system'; }
export const activeZone = () => (setting === 'system' ? systemTz() : setting);

const fmts = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmts.get(tz);
  if (!f) {
    try { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' }); }
    catch { f = fmt('UTC'); }
    fmts.set(tz, f);
  }
  return f;
}

export interface Parts { year: number; month: number; day: number; hour: number; minute: number; /** 0 = Sunday */ weekday: number }
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Wall clock of a unix time (seconds) in a zone. */
export function zonedParts(tz: string, sec: number): Parts {
  const o: Partial<Parts> = {};
  for (const p of fmt(tz).formatToParts(new Date(sec * 1000))) {
    if (p.type === 'year') o.year = +p.value; else if (p.type === 'month') o.month = +p.value; else if (p.type === 'day') o.day = +p.value;
    else if (p.type === 'hour') o.hour = +p.value % 24; else if (p.type === 'minute') o.minute = +p.value; else if (p.type === 'weekday') o.weekday = WD.indexOf(p.value);
  }
  return o as Parts;
}

/** Offset of a zone from UTC in minutes at a given moment (DST included). */
export function offsetMin(tz: string, sec: number): number {
  const p = zonedParts(tz, sec);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(sec / 60) * 60000) / 60000);
}

export function fmtOffset(min: number): string {
  const a = Math.abs(min);
  return `UTC${min < 0 ? '-' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

/** Dropdown entries for the settings, sorted by the current offset: "(UTC+01:00) Berlin, Germany". */
export function zoneOptions(sec: number): { value: string; label: string }[] {
  const rows = ZONES.map((z) => ({ value: z.id, off: offsetMin(z.id, sec), city: z.city }));
  rows.sort((a, b) => a.off - b.off);
  return [
    { value: 'system', label: `System default (${systemTz()})` },
    { value: 'UTC', label: '(UTC+00:00) UTC, Coordinated Universal Time' },
    ...rows.map((r) => ({ value: r.value, label: `(${fmtOffset(r.off)}) ${r.city}` })),
  ];
}

/** Unix seconds of a wall clock time (HH:MM on the given calendar date) in a zone. */
export function zonedTime(tz: string, y: number, m: number, d: number, hh: number, mm: number): number {
  const guess = Date.UTC(y, m - 1, d, hh, mm) / 1000;
  let t = guess - offsetMin(tz, guess) * 60;
  t = guess - offsetMin(tz, t) * 60; // the offset at the result (matters around a DST change)
  return t;
}
