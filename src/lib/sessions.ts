// Trading session times for the cheat sheet (pure, tested): hours at the venue, in UTC and in the user's time zone, DST aware for a given day.
import { zonedParts, zonedTime } from './tz.ts';

export interface Session { name: string; city: string; tz: string; open: string; close: string }

export const SESSION_GROUPS: { title: string; note: string; rows: Session[] }[] = [
  {
    title: 'Forex sessions', note: 'The usual trading-day windows of the big forex centres (overlaps are the liquid hours).',
    rows: [
      { name: 'Sydney', city: 'Sydney', tz: 'Australia/Sydney', open: '07:00', close: '16:00' },
      { name: 'Tokyo', city: 'Tokyo', tz: 'Asia/Tokyo', open: '09:00', close: '18:00' },
      { name: 'London', city: 'London', tz: 'Europe/London', open: '08:00', close: '17:00' },
      { name: 'New York', city: 'New York', tz: 'America/New_York', open: '08:00', close: '17:00' },
    ],
  },
  {
    title: 'Stock exchanges', note: 'Continuous trading hours. Breaks (Tokyo, Hong Kong, Shanghai lunch) are not shown.',
    rows: [
      { name: 'ASX', city: 'Sydney', tz: 'Australia/Sydney', open: '10:00', close: '16:00' },
      { name: 'Tokyo (TSE)', city: 'Tokyo', tz: 'Asia/Tokyo', open: '09:00', close: '15:30' },
      { name: 'Shanghai (SSE)', city: 'Shanghai', tz: 'Asia/Shanghai', open: '09:30', close: '15:00' },
      { name: 'Hong Kong (HKEX)', city: 'Hong Kong', tz: 'Asia/Hong_Kong', open: '09:30', close: '16:00' },
      { name: 'India (NSE)', city: 'Mumbai', tz: 'Asia/Kolkata', open: '09:15', close: '15:30' },
      { name: 'Xetra', city: 'Frankfurt', tz: 'Europe/Berlin', open: '09:00', close: '17:30' },
      { name: 'London (LSE)', city: 'London', tz: 'Europe/London', open: '08:00', close: '16:30' },
      { name: 'US pre-market', city: 'New York', tz: 'America/New_York', open: '04:00', close: '09:30' },
      { name: 'US regular (NYSE, Nasdaq)', city: 'New York', tz: 'America/New_York', open: '09:30', close: '16:00' },
      { name: 'US after-hours', city: 'New York', tz: 'America/New_York', open: '16:00', close: '20:00' },
    ],
  },
];

const hm = (t: string) => t.split(':').map(Number) as [number, number];
const pad = (n: number) => String(n).padStart(2, '0');

export interface SessionRow { open: number; close: number; local: string; utc: string; mine: string; isOpen: (now: number) => boolean }

/** "HH:MM" of an instant in a zone, with +1 / -1 when that is another calendar day than `ref` (day of the venue). */
function clock(tz: string, sec: number, refDay: number): string {
  const p = zonedParts(tz, sec);
  const day = Date.UTC(p.year, p.month - 1, p.day) / 86400000;
  const d = day - refDay;
  return `${pad(p.hour)}:${pad(p.minute)}${d ? ` (${d > 0 ? '+' : ''}${d}d)` : ''}`;
}

/** One session on a given calendar day (y-m-d at the venue): the same window as clock times in the venue, UTC and the user's zone. */
export function sessionRow(s: Session, y: number, m: number, d: number, userTz: string): SessionRow {
  const [oh, om] = hm(s.open), [ch, cm] = hm(s.close);
  const open = zonedTime(s.tz, y, m, d, oh, om), close = zonedTime(s.tz, y, m, d, ch, cm);
  const refDay = Date.UTC(y, m - 1, d) / 86400000;
  const win = (tz: string) => `${clock(tz, open, refDay)} - ${clock(tz, close, refDay)}`;
  return { open, close, local: `${s.open} - ${s.close}`, utc: win('UTC'), mine: win(userTz), isOpen: (now) => now >= open && now < close };
}
