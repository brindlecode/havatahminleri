import test from 'node:test';
import assert from 'node:assert/strict';
import { sameDayReusable } from '../scripts/fetch-weather.mjs';

const DAY = '2026-09-26';
const NOW = Date.parse('2026-09-26T09:00:00Z');
const LOCS = [['41.01_28.98', {}], ['39.92_32.85', {}]];
const entry = (day) => ({ daily: { time: [day] } });
const cache = (over = {}) => ({
  fetchedAt: '2026-09-25T21:10:00Z', // 00:10 Istanbul time on the 26th
  data: { '41.01_28.98': entry(DAY), '39.92_32.85': entry(DAY) },
  ...over,
});

test('a complete, recent cache for today is reused', () => {
  const r = sameDayReusable(cache(), LOCS, DAY, NOW);
  assert.equal(r.ok, true, r.reason);
});

test('a new Istanbul date always refetches', () => {
  assert.equal(sameDayReusable(cache(), LOCS, '2026-09-27', NOW).ok, false);
});

test('missing or stale locations, old or synthetic caches are not reused', () => {
  assert.equal(sameDayReusable(null, LOCS, DAY, NOW).ok, false);
  assert.equal(sameDayReusable(cache({ synthetic: true }), LOCS, DAY, NOW).ok, false);
  assert.equal(sameDayReusable(cache({ fetchedAt: '2026-09-25T12:00:00Z' }), LOCS, DAY, NOW).ok, false, '21h old');
  assert.equal(sameDayReusable(cache({ fetchedAt: undefined }), LOCS, DAY, NOW).ok, false);
  assert.equal(sameDayReusable(cache({ fetchedAt: '2026-09-26T10:00:00Z' }), LOCS, DAY, NOW).ok, false, 'future');
  const partial = cache({ data: { '41.01_28.98': entry(DAY), '39.92_32.85': entry('2026-09-25') } });
  assert.equal(sameDayReusable(partial, LOCS, DAY, NOW).ok, false);
  const missing = cache({ data: { '41.01_28.98': entry(DAY) } });
  assert.equal(sameDayReusable(missing, LOCS, DAY, NOW).ok, false);
});
