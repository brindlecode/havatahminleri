import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getAlerts, maxAlertLevel } from '../src/lib/alerts.ts';
import { airDay, aqiBand, seaDay, seaFeel } from '../src/lib/extras.ts';
import { monthAnswer, clothing, MONTHS } from '../src/lib/climate.ts';
import {
  parseMeteoalarmJson,
  parseMeteoalarmAtom,
  finaliseWarnings,
  matchPlates,
  awarenessLevel,
} from '../scripts/fetch-extras.mjs';
import { aggregate } from '../scripts/fetch-climate.mjs';

const provinces = JSON.parse(readFileSync(new URL('../src/data/provinces.json', import.meta.url), 'utf-8'));

function weather(days) {
  const daily = {
    time: [], weatherCode: [], temperatureMax: [], temperatureMin: [], precipitationSum: [],
    precipitationProbabilityMax: [], windSpeedMax: [], uvIndexMax: [], sunrise: [], sunset: [],
  };
  days.forEach((d, i) => {
    daily.time.push(`2026-10-0${8 + i}`);
    daily.weatherCode.push(d.code ?? 1);
    daily.temperatureMax.push(d.hi ?? 20);
    daily.temperatureMin.push(d.lo ?? 10);
    daily.precipitationSum.push(d.rain ?? 0);
    daily.precipitationProbabilityMax.push(d.prob ?? 0);
    daily.windSpeedMax.push(d.wind ?? 10);
    daily.uvIndexMax.push(3);
    daily.sunrise.push('');
    daily.sunset.push('');
  });
  return { current: {}, hourly: { time: [] }, daily };
}

test('a calm forecast raises no alert', () => {
  assert.deepEqual(getAlerts(weather([{}, {}])), []);
});

test('alerts follow the published thresholds', () => {
  const a = getAlerts(weather([{ code: 63, rain: 30, prob: 80 }, { wind: 70, hi: 43 }]));
  const kinds = a.map((x) => `${x.day}:${x.kind}:${x.level}`).sort();
  assert.deepEqual(kinds, ['0:rain:1', '1:heat:2', '1:wind:2']);
  assert.equal(maxAlertLevel(a), 2);
  // Most severe first.
  assert.equal(a[0].level, 2);
});

test('a thunderstorm day is one storm alert, not a separate rain alert too', () => {
  const a = getAlerts(weather([{ code: 95, rain: 30, prob: 90 }, {}]));
  assert.deepEqual(a.map((x) => x.kind), ['storm']);
  assert.match(a[0].detail, /30 mm/);
});

test('snow needs an amount, and cold only fires at -15', () => {
  assert.deepEqual(getAlerts(weather([{ code: 71, rain: 1 }, { lo: -14 }])), []);
  const a = getAlerts(weather([{ code: 75, rain: 12 }, { lo: -16 }]));
  assert.deepEqual(a.map((x) => `${x.kind}:${x.level}`), ['snow:2', 'cold:1']);
});

test('air quality bands and the day summary', () => {
  assert.equal(aqiBand(15).label, 'İyi');
  assert.equal(aqiBand(40).label, 'Makul');
  assert.equal(aqiBand(55).label, 'Orta');
  assert.equal(aqiBand(130).label, 'Son derece kötü');
  const aqi = Array.from({ length: 48 }, (_, i) => (i === 19 ? 85 : 30));
  const s = { time: [], aqi, pm25: aqi.map(() => 12), pm10: aqi.map(() => 20) };
  const d = airDay(s, 0);
  assert.equal(d.typical, 30);
  assert.equal(d.worst, 85);
  assert.equal(d.worstHour, 19);
  assert.equal(d.worstBand.key, 'vpoor');
  assert.equal(airDay(null, 0), null);
  assert.equal(airDay({ ...s, aqi: aqi.map(() => null) }, 1), null);
});

test('sea day uses the noon value', () => {
  const sst = Array.from({ length: 48 }, (_, i) => (i === 12 ? 24.4 : 23));
  const d = seaDay({ time: [], sst, waveMax: [0.3, 1.4] }, 0);
  assert.equal(d.temp, 24);
  assert.equal(d.wave, 0.3);
  assert.equal(seaFeel(17), 'soğuk');
  assert.equal(seaFeel(26), 'ılık');
});

test('MeteoAlarm JSON: Turkish info is preferred and expired or green warnings are dropped', () => {
  const doc = {
    warnings: [
      {
        uuid: 'a',
        alert: {
          identifier: 'a1',
          info: [
            { language: 'en-GB', event: 'Wind', area: [{ areaDesc: 'Istanbul' }] },
            {
              language: 'tr-TR', event: 'Kuvvetli rüzgar', severity: 'Severe',
              onset: '2030-01-01T06:00:00+03:00', expires: '2030-01-01T18:00:00+03:00',
              parameter: [{ valueName: 'awareness_level', value: '3; orange; Severe' }, { valueName: 'awareness_type', value: '1; Wind' }],
              area: [{ areaDesc: 'İstanbul' }, { areaDesc: 'Kocaeli' }],
            },
          ],
        },
      },
      { alert: { identifier: 'b', info: [{ language: 'tr', severity: 'Minor', expires: '2030-01-01T00:00:00Z', area: [{ areaDesc: 'Ankara' }] }] } },
      { alert: { identifier: 'c', info: [{ language: 'tr', severity: 'Moderate', expires: '2000-01-01T00:00:00Z', area: [{ areaDesc: 'İzmir' }] }] } },
    ],
  };
  const items = finaliseWarnings(parseMeteoalarmJson(doc), provinces, Date.parse('2029-12-31T00:00:00Z'));
  assert.equal(items.length, 1);
  assert.equal(items[0].level, 3);
  assert.equal(items[0].type, 'wind');
  assert.equal(items[0].event, 'Kuvvetli rüzgar');
  assert.deepEqual(items[0].plates, [34, 41]);
});

test('MeteoAlarm Atom entries parse', () => {
  const xml = `<feed><entry><title>Yellow Wind Warning</title><cap:event>Wind</cap:event><cap:severity>Moderate</cap:severity>
    <cap:onset>2030-01-01T06:00:00+03:00</cap:onset><cap:expires>2030-01-02T06:00:00+03:00</cap:expires><cap:areaDesc>Muğla</cap:areaDesc></entry></feed>`;
  const [w] = parseMeteoalarmAtom(xml);
  assert.equal(w.level, 2);
  assert.equal(w.type, 'wind');
  assert.deepEqual(w.areas, ['Muğla']);
});

test('area names match provinces regardless of case, diacritics and aliases', () => {
  assert.deepEqual(matchPlates('KAHRAMANMARAŞ', provinces), [46]);
  assert.deepEqual(matchPlates('Afyon', provinces), [3]);
  assert.deepEqual(matchPlates('Igdir province', provinces), [76]);
  assert.deepEqual(matchPlates('Doğu Karadeniz', provinces), []);
  assert.equal(awarenessLevel('', 'Extreme'), 4);
});

test('climate aggregation: monthly means, totals per year and records', () => {
  const time = [];
  const hi = [];
  const lo = [];
  const p = [];
  for (const y of [2023, 2024]) {
    for (let d = 1; d <= 31; d++) {
      time.push(`${y}-01-${String(d).padStart(2, '0')}`);
      hi.push(y === 2024 && d === 5 ? 15 : 5);
      lo.push(-2);
      p.push(d <= 4 ? 5 : 0);
    }
  }
  const rows = aggregate({ time, temperature_2m_max: hi, temperature_2m_min: lo, precipitation_sum: p });
  assert.equal(rows.length, 12);
  const jan = rows[0];
  assert.equal(jan.precip, 20);
  assert.equal(jan.rainyDays, 4);
  assert.equal(jan.frostDays, 31);
  assert.equal(jan.recordHi, 15);
  assert.equal(jan.recordHiYear, 2024);
});

test('climate prose', () => {
  const m = { hi: 33, lo: 23, mean: 28, precip: 4, rainyDays: 0.6, snowyDays: 0, hotDays: 25, frostDays: 0, sunHours: 12.4, windMax: 18, recordHi: 41, recordHiYear: 2021, recordLo: 18, recordLoYear: 2016 };
  const s = monthAnswer("Antalya'da", 6, m);
  assert.match(s, /^Antalya'da temmuz ayında hava genellikle çok sıcak geçer/);
  assert.match(s, /neredeyse kuru/);
  assert.match(s, /12,4 saat/);
  assert.match(clothing(m), /İnce/);
  assert.equal(MONTHS.length, 12);
});
