import test from 'node:test';
import assert from 'node:assert/strict';
import { getActivityAdvice } from '../src/lib/activityAdvice.ts';
import { PERIODS } from '../src/lib/periods.ts';

/**
 * 16 days starting Sunday 2026-10-04. `days` overrides per-day values:
 * { prob, sum, wind, hi, lo, code }.
 */
function makeWeather(days = {}) {
  const daily = {
    time: [], weatherCode: [], temperatureMax: [], temperatureMin: [],
    precipitationSum: [], precipitationProbabilityMax: [], windSpeedMax: [],
    uvIndexMax: [], sunrise: [], sunset: [],
  };
  for (let i = 0; i < 16; i++) {
    const d = new Date('2026-10-04T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + i);
    const date = d.toISOString().slice(0, 10);
    const o = days[i] ?? {};
    daily.time.push(date);
    daily.weatherCode.push(o.code ?? 1);
    daily.temperatureMax.push(o.hi ?? 22);
    daily.temperatureMin.push(o.lo ?? 12);
    daily.precipitationSum.push(o.sum ?? 0);
    daily.precipitationProbabilityMax.push(o.prob ?? 5);
    daily.windSpeedMax.push(o.wind ?? 12);
    daily.uvIndexMax.push(4);
    daily.sunrise.push(`${date}T07:05`);
    daily.sunset.push(`${date}T18:40`);
  }
  const hourly = {
    time: [], temperature: [], weatherCode: [], humidity: [],
    precipitationProbability: [], windSpeed: [], isDay: [],
    dewPoint: [], visibility: [], pressure: [], cloudCover: [],
  };
  for (let i = 0; i < 48; i++) {
    hourly.time.push(`${daily.time[Math.floor(i / 24)]}T${String(i % 24).padStart(2, '0')}:00`);
    hourly.temperature.push(18);
    hourly.weatherCode.push(1);
    hourly.humidity.push(55);
    hourly.precipitationProbability.push(5);
    hourly.windSpeed.push(10);
    hourly.isDay.push(i % 24 >= 7 && i % 24 < 19 ? 1 : 0);
    hourly.dewPoint.push(9);
    hourly.visibility.push(12000);
    hourly.pressure.push(1012);
    hourly.cloudCover.push(20);
  }
  return {
    current: {
      temperature: 20, weatherCode: 1, windSpeed: 10, windDirection: 180,
      humidity: 55, apparentTemperature: 20, isDay: true,
      pressure: 1012, cloudCover: 20, visibility: 12000,
    },
    hourly,
    daily,
  };
}

const byId = (set, id) => set.items.find((i) => i.id === id);

test('every period produces three activities with share text', () => {
  const W = makeWeather();
  for (const id of ['base', ...PERIODS.map((p) => p.id)]) {
    const set = getActivityAdvice(W, id, 'İzmit');
    assert.ok(set, id);
    assert.deepEqual(set.items.map((i) => i.id), ['arac', 'cam', 'camasir']);
    for (const item of set.items) {
      assert.ok(item.headline && item.detail, `${id}/${item.id}`);
      assert.match(item.shareText, /İzmit'te/);
      assert.doesNotMatch(item.detail + item.headline, /undefined|NaN/);
    }
    assert.match(set.shareText, /Araç yıkama/);
  }
});

test('dry week: everything is suitable tomorrow', () => {
  const set = getActivityAdvice(makeWeather(), 'yarin', 'İzmit');
  assert.equal(set.heading, 'Yarın araba yıkanır mı, cam silinir mi?');
  for (const item of set.items) assert.equal(item.verdict, 'good', item.id);
  assert.match(byId(set, 'arac').detail, /sonraki 4 gün de kuru/);
  assert.match(byId(set, 'arac').dayLabel, /^Yarın · 5 Ekim Pazartesi$/);
});

test('rain on the day: postpone and suggest a better day', () => {
  const W = makeWeather({ 1: { prob: 85, sum: 6.4, code: 63 }, 2: { prob: 60, sum: 2 } });
  const car = byId(getActivityAdvice(W, 'yarin', 'İzmit'), 'arac');
  assert.equal(car.verdict, 'poor');
  assert.match(car.detail, /Yarın İzmit'te %85 olasılıkla yağış \(6,4 mm\) bekleniyor/);
  // day 2 is wet too, day 3 is followed by dry days -> Çarşamba.
  assert.match(car.detail, /Daha uygun gün: Çarşamba \(7 Ekim\)\./);
});

test('the alternative day may be a full week after the target', () => {
  const wet = { prob: 90, sum: 5 };
  // days 1-7 wet, day 8 (seven days after tomorrow) dry with dry days after it
  const W = makeWeather({ 1: wet, 2: wet, 3: wet, 4: wet, 5: wet, 6: wet, 7: wet });
  const laundry = byId(getActivityAdvice(W, 'yarin', 'İzmit'), 'camasir');
  assert.equal(laundry.verdict, 'poor');
  assert.match(laundry.detail, /Daha uygun gün: Pazartesi \(12 Ekim\)\./);
});

test('rain the day after spoils a car wash today', () => {
  const W = makeWeather({ 1: { prob: 70, sum: 3 } });
  const set = getActivityAdvice(W, 'bugun', 'Kars');
  const car = byId(set, 'arac');
  assert.equal(car.verdict, 'poor');
  assert.match(car.detail, /Bugün hava kuru ama yarın %70/);
  // laundry only cares about the day itself
  assert.equal(byId(set, 'camasir').verdict, 'good');
  assert.match(set.shareText, /Kars'ta bugün/);
});

test('strong wind means dust on a freshly washed car', () => {
  const car = byId(getActivityAdvice(makeWeather({ 1: { wind: 48 } }), 'yarin', 'Adana'), 'arac');
  assert.equal(car.verdict, 'fair');
  assert.match(car.detail, /48 km\/s/);
});

test('frost and heat are flagged', () => {
  const cold = getActivityAdvice(makeWeather({ 1: { lo: -3, hi: 5 } }), 'yarin', 'Erzurum');
  assert.equal(byId(cold, 'arac').verdict, 'fair');
  assert.equal(byId(cold, 'camasir').verdict, 'fair');
  const hot = getActivityAdvice(makeWeather({ 1: { hi: 38, lo: 26 } }), 'yarin', 'Şanlıurfa');
  assert.equal(byId(hot, 'cam').verdict, 'fair');
  assert.match(byId(hot, 'cam').detail, /38°C/);
});

test('range pages pick the first good day of the week', () => {
  const W = makeWeather({ 0: { prob: 90, sum: 8 }, 1: { prob: 80, sum: 4 }, 2: { prob: 10 } });
  const set = getActivityAdvice(W, '7gun', 'Rize');
  assert.match(set.heading, /en uygun gün/);
  const laundry = byId(set, 'camasir');
  assert.equal(laundry.verdict, 'good');
  assert.match(laundry.dayLabel, /6 Ekim Salı/);
  assert.match(set.shareText, /Çamaşır kurutma: 6 Ekim Salı ✅/);
});

test('headline choice is stable for the same place and day', () => {
  const W = makeWeather();
  const a = getActivityAdvice(W, 'yarin', 'İzmit');
  const b = getActivityAdvice(W, 'yarin', 'İzmit');
  assert.deepEqual(a, b);
});
