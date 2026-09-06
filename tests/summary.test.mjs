import test from 'node:test';
import assert from 'node:assert/strict';
import { getPeriodSummary, getPeriodFAQs, rangeStats, weekdayName, isWeekend } from '../src/lib/periodSummary.ts';
import { PERIODS } from '../src/lib/periods.ts';

function makeWeather() {
  const daily = {
    time: [], weatherCode: [], temperatureMax: [], temperatureMin: [],
    precipitationSum: [], precipitationProbabilityMax: [], windSpeedMax: [],
    uvIndexMax: [], sunrise: [], sunset: [],
  };
  for (let i = 0; i < 16; i++) {
    const d = new Date('2026-09-06T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + i);
    const date = d.toISOString().slice(0, 10);
    daily.time.push(date);
    daily.weatherCode.push(i % 3 === 0 ? 61 : 0);
    daily.temperatureMax.push(24 + (i % 6));
    daily.temperatureMin.push(12 + (i % 4));
    daily.precipitationSum.push(i % 3 === 0 ? 3.2 : 0);
    daily.precipitationProbabilityMax.push(i % 3 === 0 ? 80 : 15);
    daily.windSpeedMax.push(12 + i);
    daily.uvIndexMax.push(6);
    daily.sunrise.push(`${date}T06:32`);
    daily.sunset.push(`${date}T19:41`);
  }
  const hourly = {
    time: [], temperature: [], weatherCode: [], humidity: [],
    precipitationProbability: [], windSpeed: [], isDay: [],
    dewPoint: [], visibility: [], pressure: [], cloudCover: [],
  };
  for (let i = 0; i < 48; i++) {
    const d = new Date('2026-09-06T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + Math.floor(i / 24));
    hourly.time.push(`${d.toISOString().slice(0, 10)}T${String(i % 24).padStart(2, '0')}:00`);
    hourly.temperature.push(16 + ((i % 24) < 12 ? i % 24 : 24 - (i % 24)));
    hourly.weatherCode.push(0);
    hourly.humidity.push(55);
    hourly.precipitationProbability.push(i % 24 >= 15 && i % 24 <= 17 ? 75 : 10);
    hourly.windSpeed.push(6 + (i % 9));
    hourly.isDay.push(i % 24 >= 7 && i % 24 < 19 ? 1 : 0);
    hourly.dewPoint.push(9);
    hourly.visibility.push(12000);
    hourly.pressure.push(1011);
    hourly.cloudCover.push(30);
  }
  return {
    current: {
      temperature: 22, weatherCode: 0, windSpeed: 9, windDirection: 200,
      humidity: 55, apparentTemperature: 21, isDay: true,
      pressure: 1011, cloudCover: 30, visibility: 12000,
    },
    hourly,
    daily,
  };
}

const W = makeWeather();
const ALL = ['base', ...PERIODS.map((p) => p.id)];

test('weekday names are computed in the forecast timezone', () => {
  assert.equal(weekdayName('2026-09-06'), 'Pazar');
  assert.equal(weekdayName('2026-09-07'), 'Pazartesi');
  assert.equal(weekdayName('2026-09-12'), 'Cumartesi');
  assert.ok(isWeekend('2026-09-06'));
  assert.ok(isWeekend('2026-09-12'));
  assert.ok(!isWeekend('2026-09-09'));
});

test('every period produces non-empty, data-bearing blocks', () => {
  for (const id of ALL) {
    const blocks = getPeriodSummary(W, id, 'Kocaeli');
    assert.ok(blocks.length >= 2, `${id} produced ${blocks.length} blocks`);
    for (const b of blocks) {
      assert.ok(b.heading.trim().length > 0, `${id} empty heading`);
      assert.ok(b.paragraph.trim().length > 40, `${id} thin paragraph: ${b.paragraph}`);
      assert.ok(!/undefined|NaN|Infinity/.test(b.paragraph), `${id}: ${b.paragraph}`);
      assert.ok(!/undefined|NaN/.test(b.heading), `${id}: ${b.heading}`);
      for (const s of b.stats ?? []) {
        assert.ok(!/undefined|NaN|Infinity/.test(s.value), `${id} stat ${s.label}=${s.value}`);
      }
    }
  }
});

test('period pages do not share their summary text', () => {
  const bodies = new Map();
  for (const id of ALL) {
    bodies.set(id, getPeriodSummary(W, id, 'Kocaeli').map((b) => b.heading + b.paragraph).join('\n'));
  }
  // base and yarin intentionally share content: they are the same intent and
  // the consolidation of /yarin/ into the base URL is a pending migration.
  const distinct = ALL.filter((id) => id !== 'yarin');
  for (let i = 0; i < distinct.length; i++) {
    for (let j = i + 1; j < distinct.length; j++) {
      assert.notEqual(
        bodies.get(distinct[i]),
        bodies.get(distinct[j]),
        `${distinct[i]} and ${distinct[j]} render identical summaries`,
      );
    }
  }
});

test('each period talks about its own range', () => {
  const text = (id) => getPeriodSummary(W, id, 'Kocaeli').map((b) => b.heading + ' ' + b.paragraph).join(' ');
  assert.match(text('bugun'), /bugün/i);
  assert.match(text('yarin'), /yarın/i);
  assert.match(text('7gun'), /7 gün/i);
  assert.match(text('10gun'), /10 gün|ilk 5 gün/i);
  assert.match(text('15gun'), /15 gün/i);
  assert.match(text('saatlik'), /48 saat/i);
});

test('the 15 day summary describes 15 days, not 16', () => {
  const blocks = getPeriodSummary(W, '15gun', 'Kocaeli');
  const dayCount = blocks[0].stats.find((s) => s.label === 'Gün sayısı');
  assert.equal(dayCount.value, '15');
  assert.ok(!blocks.some((b) => /16 gün/.test(b.paragraph)), 'must not mention 16 days');
});

test('rangeStats reports a coherent picture', () => {
  const s = rangeStats(W, 0, 7);
  assert.equal(s.count, 7);
  assert.ok(s.maxTemp >= s.minTemp);
  assert.ok(s.warmest.temp >= s.coldest.temp);
  assert.ok(s.rainyDays.length <= 7);
  assert.ok(s.highVariability >= 0);
});

test('a rain-free forecast never claims rain', () => {
  const dry = makeWeather();
  dry.daily.precipitationSum = dry.daily.precipitationSum.map(() => 0);
  dry.daily.precipitationProbabilityMax = dry.daily.precipitationProbabilityMax.map(() => 5);
  dry.hourly.precipitationProbability = dry.hourly.precipitationProbability.map(() => 5);

  for (const id of ALL) {
    const text = getPeriodSummary(dry, id, 'Kocaeli').map((b) => b.paragraph).join(' ');
    assert.ok(
      !/gününde yağış bekleniyor|yağış olasılığı %50'nin üzerine çıkıyor/.test(text),
      `${id} invented rain: ${text}`,
    );
  }
});

test('a rainy forecast never reports a total that contradicts the day count', () => {
  const showers = makeWeather();
  // High probability, zero accumulation - the combination that produced
  // "15 gününde yağış bekleniyor ... Toplam yağış miktarı 0 mm".
  showers.daily.precipitationSum = showers.daily.precipitationSum.map(() => 0);
  showers.daily.precipitationProbabilityMax = showers.daily.precipitationProbabilityMax.map(() => 85);

  for (const id of ['7gun', '10gun', '15gun']) {
    const text = getPeriodSummary(showers, id, 'Kocaeli').map((b) => b.paragraph).join(' ');
    assert.ok(!/toplam 0 mm/i.test(text), `${id} claims a 0 mm total: ${text}`);
  }
});

test('FAQs are period-specific and answer with numbers', () => {
  const seen = new Set();
  for (const id of ALL) {
    const faqs = getPeriodFAQs(W, id, 'Kocaeli');
    assert.ok(faqs.length >= 1, id);
    for (const f of faqs) {
      assert.ok(f.question.endsWith('?'), `${id}: ${f.question}`);
      assert.ok(f.answer.length > 30, `${id}: ${f.answer}`);
      assert.ok(!/undefined|NaN/.test(f.answer), `${id}: ${f.answer}`);
    }
    if (id !== 'yarin') {
      const key = faqs.map((f) => f.question).join('|');
      assert.ok(!seen.has(key), `${id} reuses another period's FAQ set`);
      seen.add(key);
    }
  }
});

test('the 15 day FAQ set targets the query family we are recovering', () => {
  const faqs = getPeriodFAQs(W, '15gun', 'Kocaeli');
  const joined = faqs.map((f) => f.question + ' ' + f.answer).join(' ');
  assert.match(joined, /Kocaeli 15 günlük hava durumu tahmini nedir\?/);
  assert.match(joined, /güvenilir|doğru/i, 'should set expectations about long-range accuracy');
});
