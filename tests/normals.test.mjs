import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dailyNormal, anomalyBand, compareToNormals } from '../src/lib/normals.ts';

const climate = JSON.parse(readFileSync(new URL('../src/data/climate.json', import.meta.url), 'utf-8'));

// A synthetic year: month m (0-11) has a high of 10 + m and a low of m.
const rows = Array.from({ length: 12 }, (_, m) => ({
  hi: 10 + m, lo: m, mean: 5 + m, precip: 31 * (m + 1), rainyDays: 5, snowyDays: 0, hotDays: 0,
  frostDays: 0, sunHours: 6, windMax: 20, recordHi: 20 + m, recordHiYear: 2020, recordLo: m - 10, recordLoYear: 2016,
}));

function daily(dates, his, los = his.map((h) => h - 8), rain = his.map(() => 0)) {
  return {
    time: dates, temperatureMax: his, temperatureMin: los, precipitationSum: rain,
    weatherCode: dates.map(() => 1), precipitationProbabilityMax: dates.map(() => 0),
    windSpeedMax: dates.map(() => 10), uvIndexMax: dates.map(() => 3), sunrise: [], sunset: [],
  };
}

test('mid-month equals the monthly normal; month ends sit between neighbours', () => {
  assert.ok(Math.abs(dailyNormal(rows, '2026-03-16').hi - 12) < 0.05);
  const end = dailyNormal(rows, '2026-03-31').hi;
  assert.ok(end > 12 && end < 13, `31 March ${end}`);
  const start = dailyNormal(rows, '2026-03-01').hi;
  assert.ok(start < 12 && start > 11, `1 March ${start}`);
});

test('interpolation wraps around the year', () => {
  const dec = dailyNormal(rows, '2026-12-31').hi; // between December (21) and January (10)
  assert.ok(dec < 21 && dec > 15, `31 December ${dec}`);
  const jan = dailyNormal(rows, '2026-01-01').hi;
  assert.ok(jan > 10 && jan < 16, `1 January ${jan}`);
});

test('daily precipitation normal spreads the monthly total', () => {
  // October total 310 mm over 31 days.
  assert.ok(Math.abs(dailyNormal(rows, '2026-10-16').precip - 10) < 0.1);
});

test('anomaly bands', () => {
  assert.equal(anomalyBand(0), 'normal');
  assert.equal(anomalyBand(1), 'normal');
  assert.equal(anomalyBand(2), 'warmer');
  assert.equal(anomalyBand(5), 'much-warmer');
  assert.equal(anomalyBand(-2), 'colder');
  assert.equal(anomalyBand(-6), 'much-colder');
});

test('no normals or no days: no comparison', () => {
  assert.equal(compareToNormals(null, daily(['2026-10-16'], [20]), 0, 1, "Kocaeli'de"), null);
  assert.equal(compareToNormals(rows, daily(['2026-10-16'], [20]), 3, 1, "Kocaeli'de"), null);
});

test('one warm day: numbers in the sentence match the table', () => {
  const cmp = compareToNormals(rows, daily(['2026-10-16'], [25]), 0, 1, "Kocaeli'de");
  assert.equal(cmp.days.length, 1);
  assert.equal(cmp.days[0].diff, 6);
  assert.equal(cmp.days[0].band, 'much-warmer');
  assert.match(cmp.summary, /^Kocaeli'de 16 Ekim Cuma için beklenen en yüksek sıcaklık 25°/);
  assert.match(cmp.summary, /19° olan mevsim normalinin 6° üzerinde/);
  // 25 > October record 29? no. No record sentence.
  assert.doesNotMatch(cmp.summary, /en yüksek değerin/);
});

test('a day equal to normal is described as such', () => {
  const cmp = compareToNormals(rows, daily(['2026-10-16'], [19]), 0, 1, "Kocaeli'de");
  assert.match(cmp.summary, /mevsim normaliyle \(19°\) aynı/);
});

test('a range reports the mean difference, counts, record and rain', () => {
  const dates = Array.from({ length: 7 }, (_, i) => `2026-10-${String(13 + i).padStart(2, '0')}`);
  const his = [19, 19, 19, 25, 19, 19, 31]; // last day beats the October record of 29
  const rain = [0, 0, 0, 0, 0, 0, 1];
  const cmp = compareToNormals(rows, daily(dates, his, undefined, rain), 0, 7, "Kocaeli'de");
  assert.equal(cmp.days.length, 7);
  assert.equal(cmp.warmerDays, 2);
  assert.equal(cmp.colderDays, 0);
  assert.ok(cmp.days[6].aboveRecord);
  assert.match(cmp.summary, /önümüzdeki 7 gün/);
  assert.match(cmp.summary, /7 günün 2 günü normalden sıcak geçiyor/);
  assert.match(cmp.summary, /En büyük sapma 19 Ekim Pazartesi: 31°, normalinden 12° yüksek/);
  assert.match(cmp.summary, /Ekim ayında görülen en yüksek değerin de üzerinde/);
  assert.match(cmp.summary, /kurak/);
});

test('a range that is warm throughout says so', () => {
  const dates = ['2026-10-14', '2026-10-15', '2026-10-16'];
  const cmp = compareToNormals(rows, daily(dates, [25, 25, 25]), 0, 3, "Kocaeli'de");
  assert.match(cmp.summary, /3 günün tamamı normalden sıcak geçiyor/);
});

test('real normals: every province has 12 usable months', () => {
  const plates = Object.keys(climate.provinces);
  assert.equal(plates.length, 81);
  for (const plate of plates) {
    const n = dailyNormal(climate.provinces[plate], '2026-10-25');
    assert.ok(Number.isFinite(n.hi) && Number.isFinite(n.lo) && n.hi > n.lo, `plate ${plate}`);
  }
});
