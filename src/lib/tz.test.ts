import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZONES, zonedParts, offsetMin, fmtOffset, zoneOptions, zonedTime } from './tz.ts';
import { sessionRow, SESSION_GROUPS } from './sessions.ts';

const utc = (y: number, m: number, d: number, h = 0, mi = 0) => Date.UTC(y, m - 1, d, h, mi) / 1000;

test('zonedParts and offsets follow DST', () => {
  const p = zonedParts('America/New_York', utc(2026, 7, 1, 13, 30));
  assert.deepEqual([p.year, p.month, p.day, p.hour, p.minute], [2026, 7, 1, 9, 30]);
  assert.equal(offsetMin('America/New_York', utc(2026, 7, 1)), -240);
  assert.equal(offsetMin('America/New_York', utc(2026, 1, 15)), -300);
  assert.equal(offsetMin('Asia/Kolkata', utc(2026, 1, 15)), 330);
  assert.equal(zonedParts('UTC', utc(2026, 3, 1, 0, 5)).hour, 0, 'midnight is hour 0, not 24');
  assert.equal(fmtOffset(-210), 'UTC-03:30'); assert.equal(fmtOffset(345), 'UTC+05:45');
});

test('zone list: valid unique zones, sorted options', () => {
  assert.equal(new Set(ZONES.map((z) => z.id)).size, ZONES.length);
  const opts = zoneOptions(utc(2026, 1, 15));
  assert.equal(opts.length, ZONES.length + 2);
  assert.ok(opts.slice(2).every((o) => /^\(UTC[+-]\d\d:\d\d\) /.test(o.label)));
  const offs = opts.slice(2).map((o) => offsetMin(o.value, utc(2026, 1, 15)));
  assert.ok(offs.every((v, i) => i === 0 || v >= offs[i - 1] - 60), 'sorted by the offset of the day it was built for');
  for (const z of ZONES) assert.ok(Number.isFinite(offsetMin(z.id, utc(2026, 6, 1))), z.id);
});

test('zonedTime round trips across a DST change', () => {
  assert.equal(zonedTime('America/New_York', 2026, 7, 1, 9, 30), utc(2026, 7, 1, 13, 30));
  assert.equal(zonedTime('America/New_York', 2026, 1, 15, 9, 30), utc(2026, 1, 15, 14, 30));
  assert.equal(zonedTime('Europe/Berlin', 2026, 3, 29, 12, 0), utc(2026, 3, 29, 10, 0), 'after the spring change (CEST)');
});

test('sessions: venue, UTC and user zone times', () => {
  const ny = SESSION_GROUPS[1].rows.find((r) => r.name.startsWith('US regular'))!;
  const summer = sessionRow(ny, 2026, 7, 1, 'Europe/Berlin');
  assert.equal(summer.local, '09:30 - 16:00'); assert.equal(summer.utc, '13:30 - 20:00'); assert.equal(summer.mine, '15:30 - 22:00');
  const winter = sessionRow(ny, 2026, 1, 15, 'Asia/Tokyo');
  assert.equal(winter.utc, '14:30 - 21:00'); assert.equal(winter.mine, '23:30 - 06:00 (+1d)');
  assert.ok(summer.isOpen(utc(2026, 7, 1, 15)) && !summer.isOpen(utc(2026, 7, 1, 21)));
  const syd = sessionRow(SESSION_GROUPS[0].rows[0], 2026, 1, 15, 'UTC');
  assert.equal(syd.utc, '20:00 (-1d) - 05:00', 'Sydney forex opens the evening before in UTC');
});
