import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDayName, istanbulDate, formatHour, formatShortDate } from '../src/lib/utils.ts';

// 2026-09-25 21:30 UTC is already 2026-09-26 00:30 in Istanbul (UTC+3): the
// once-a-day build runs in exactly this window, so "today" must follow Turkey,
// not the UTC clock of the CI runner.
const JUST_AFTER_TR_MIDNIGHT = new Date('2026-09-25T21:30:00Z');

test('istanbulDate follows Turkey time, not UTC', () => {
  assert.equal(istanbulDate(0, JUST_AFTER_TR_MIDNIGHT), '2026-09-26');
  assert.equal(istanbulDate(1, JUST_AFTER_TR_MIDNIGHT), '2026-09-27');
  assert.equal(istanbulDate(-1, JUST_AFTER_TR_MIDNIGHT), '2026-09-25');
});

test('getDayName labels today and tomorrow in Turkey time', () => {
  assert.equal(getDayName('2026-09-26', JUST_AFTER_TR_MIDNIGHT), 'Bugün');
  assert.equal(getDayName('2026-09-27', JUST_AFTER_TR_MIDNIGHT), 'Yarın');
  assert.equal(getDayName('2026-09-28', JUST_AFTER_TR_MIDNIGHT), 'Pazartesi');
});

test('getDayName never calls a past date "Bugün"', () => {
  assert.notEqual(getDayName('2026-09-25', JUST_AFTER_TR_MIDNIGHT), 'Bugün');
});

test('formatHour keeps the local hour from the API string', () => {
  assert.equal(formatHour('2026-09-26T00:00'), '00:00');
  assert.equal(formatHour('2026-09-26T14:00'), '14:00');
});

test('formatShortDate is independent of the machine timezone', () => {
  assert.match(formatShortDate('2026-09-26'), /26/);
  assert.match(formatShortDate('2026-09-26'), /Eyl/);
});
