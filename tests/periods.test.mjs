import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PERIOD_DEFS,
  PERIODS,
  getPeriodForecastData,
  getCanonicalForPeriod,
  getLocationPath,
  getPeriodLinks,
} from '../src/lib/periods.ts';
import { getPeriodSEO, getLocationNames, buildBreadcrumbs } from '../src/lib/seo.ts';

/** Minimal WeatherData with 16 daily entries and 48 hourly entries. */
function makeWeather(startDate = '2026-09-06') {
  const daily = {
    time: [], weatherCode: [], temperatureMax: [], temperatureMin: [],
    precipitationSum: [], precipitationProbabilityMax: [], windSpeedMax: [],
    uvIndexMax: [], sunrise: [], sunset: [],
  };
  for (let i = 0; i < 16; i++) {
    const d = new Date(`${startDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    const date = d.toISOString().slice(0, 10);
    daily.time.push(date);
    daily.weatherCode.push(i % 2 ? 61 : 0);
    daily.temperatureMax.push(20 + (i % 5));
    daily.temperatureMin.push(10 + (i % 3));
    daily.precipitationSum.push(i % 3 === 0 ? 2.5 : 0);
    daily.precipitationProbabilityMax.push((i * 7) % 100);
    daily.windSpeedMax.push(10 + i);
    daily.uvIndexMax.push(5);
    daily.sunrise.push(`${date}T06:30`);
    daily.sunset.push(`${date}T19:30`);
  }

  const hourly = {
    time: [], temperature: [], weatherCode: [], humidity: [],
    precipitationProbability: [], windSpeed: [], isDay: [],
    dewPoint: [], visibility: [], pressure: [], cloudCover: [],
  };
  for (let i = 0; i < 48; i++) {
    const dayOffset = Math.floor(i / 24);
    const d = new Date(`${startDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dayOffset);
    hourly.time.push(`${d.toISOString().slice(0, 10)}T${String(i % 24).padStart(2, '0')}:00`);
    hourly.temperature.push(15 + (i % 12));
    hourly.weatherCode.push(0);
    hourly.humidity.push(60);
    hourly.precipitationProbability.push(i % 24 >= 14 && i % 24 <= 16 ? 80 : 10);
    hourly.windSpeed.push(5 + (i % 10));
    hourly.isDay.push(i % 24 >= 7 && i % 24 < 19 ? 1 : 0);
    hourly.dewPoint.push(8);
    hourly.visibility.push(10000);
    hourly.pressure.push(1013);
    hourly.cloudCover.push(20);
  }

  return {
    current: {
      temperature: 21, weatherCode: 0, windSpeed: 8, windDirection: 180,
      humidity: 60, apparentTemperature: 20, isDay: true,
      pressure: 1013, cloudCover: 20, visibility: 10000,
    },
    hourly,
    daily,
  };
}

test('a period page renders exactly the number of days its name promises', () => {
  const weather = makeWeather();
  const expected = { base: 1, bugun: 1, yarin: 1, '7gun': 7, '10gun': 10, '15gun': 15, saatlik: 0 };

  for (const [periodId, days] of Object.entries(expected)) {
    const { daily } = getPeriodForecastData(weather, periodId);
    assert.equal(daily.time.length, days, `${periodId} should render ${days} day rows`);
    // Every parallel array must be sliced the same way or the table misaligns.
    for (const key of Object.keys(daily)) {
      assert.equal(daily[key].length, days, `${periodId}.${key}`);
    }
  }
});

test('the 15 day page shows 15 days even though the API returns 16', () => {
  const weather = makeWeather('2026-09-06');
  assert.equal(weather.daily.time.length, 16, 'fixture mirrors forecast_days=16');
  const { daily } = getPeriodForecastData(weather, '15gun');
  assert.equal(daily.time.length, 15);
  assert.equal(daily.time[0], '2026-09-06');
  assert.equal(daily.time.at(-1), '2026-09-20');
});

test('tomorrow-based views start at day index 1', () => {
  const weather = makeWeather('2026-09-06');
  for (const periodId of ['base', 'yarin']) {
    const { daily } = getPeriodForecastData(weather, periodId);
    assert.equal(daily.time[0], '2026-09-07', periodId);
  }
  const today = getPeriodForecastData(weather, 'bugun');
  assert.equal(today.daily.time[0], '2026-09-06');
});

test('hourly ranges match the period', () => {
  const weather = makeWeather();
  assert.deepEqual(
    ['bugun', 'yarin', 'base', 'saatlik'].map((p) => {
      const d = getPeriodForecastData(weather, p);
      return [d.hourlyStart, d.hourlyEnd];
    }),
    [[0, 24], [24, 48], [24, 48], [0, 48]],
  );
  for (const p of ['7gun', '10gun', '15gun']) {
    assert.equal(getPeriodForecastData(weather, p).showHourly, false, p);
  }
});

test('slicing never runs past the available data', () => {
  const weather = makeWeather();
  weather.daily.time = weather.daily.time.slice(0, 4);
  weather.daily.temperatureMax = weather.daily.temperatureMax.slice(0, 4);
  weather.daily.temperatureMin = weather.daily.temperatureMin.slice(0, 4);
  const { daily } = getPeriodForecastData(weather, '15gun');
  assert.equal(daily.time.length, 4);
});

test('canonical URLs are absolute, https and trailing-slashed', () => {
  const cases = [
    [getCanonicalForPeriod('kocaeli', 'base'), 'https://yarinhava.com/kocaeli-hava-durumu/'],
    [getCanonicalForPeriod('kocaeli', '15gun'), 'https://yarinhava.com/kocaeli-hava-durumu/15-gunluk/'],
    [getCanonicalForPeriod('kocaeli', 'saatlik'), 'https://yarinhava.com/kocaeli-hava-durumu/saatlik/'],
    [getCanonicalForPeriod('kocaeli', 'base', 'izmit'), 'https://yarinhava.com/kocaeli/izmit-hava-durumu/'],
    [getCanonicalForPeriod('kocaeli', '15gun', 'izmit'), 'https://yarinhava.com/kocaeli/izmit-hava-durumu/15-gunluk/'],
  ];
  for (const [actual, expected] of cases) {
    assert.equal(actual, expected);
    assert.ok(actual.endsWith('/'), `${actual} must end with a slash`);
  }
});

test('period navigation links every intent exactly once', () => {
  const links = getPeriodLinks('/kocaeli-hava-durumu');
  assert.equal(links.length, 6);
  assert.equal(new Set(links.map((l) => l.href)).size, 6);
  for (const l of links) assert.ok(l.href.endsWith('/'), l.href);
  assert.deepEqual(
    links.map((l) => l.href),
    [
      '/kocaeli-hava-durumu/bugun/',
      '/kocaeli-hava-durumu/yarin/',
      '/kocaeli-hava-durumu/7-gunluk/',
      '/kocaeli-hava-durumu/10-gunluk/',
      '/kocaeli-hava-durumu/15-gunluk/',
      '/kocaeli-hava-durumu/saatlik/',
    ],
  );
});

test('getLocationPath always produces a trailing slash', () => {
  assert.equal(getLocationPath('kocaeli'), '/kocaeli-hava-durumu/');
  assert.equal(getLocationPath('kocaeli', 'izmit'), '/kocaeli/izmit-hava-durumu/');
});

// --- search-intent ownership -------------------------------------------------

const KOCAELI = { provinceName: 'Kocaeli', provinceSlug: 'kocaeli', lat: 40.77, lon: 29.95 };
const IZMIT = { ...KOCAELI, districtName: 'İzmit', districtSlug: 'i-zmit' };

test('the base location page no longer claims the 15 day intent', () => {
  const base = getPeriodSEO(KOCAELI, 'base');
  assert.ok(!/15\s*Günlük/i.test(base.title), `base title still says 15 Günlük: ${base.title}`);
  assert.ok(!/15\s*günlük/i.test(base.description), `base description still says 15 günlük`);
  assert.match(base.title, /Yarın/);

  const fifteen = getPeriodSEO(KOCAELI, '15gun');
  assert.match(fifteen.title, /15 Günlük/);
  assert.equal(fifteen.canonical, 'https://yarinhava.com/kocaeli-hava-durumu/15-gunluk/');
});

test('every period on a location produces a distinct title, description and H1', () => {
  for (const loc of [KOCAELI, IZMIT]) {
    const ids = ['base', ...PERIODS.map((p) => p.id)];
    const seos = ids.map((id) => getPeriodSEO(loc, id));
    for (const field of ['title', 'description', 'heading', 'canonical']) {
      const values = seos.map((s) => s[field]);
      assert.equal(
        new Set(values).size,
        values.length,
        `duplicate ${field} across periods: ${JSON.stringify(values)}`,
      );
    }
  }
});

test('titles and descriptions stay within sane SERP lengths', () => {
  for (const loc of [KOCAELI, IZMIT]) {
    for (const id of ['base', ...PERIODS.map((p) => p.id)]) {
      const seo = getPeriodSEO(loc, id);
      assert.ok(seo.description.length >= 80, `${id} description too short: ${seo.description.length}`);
      assert.ok(seo.description.length <= 160, `${id} description too long: ${seo.description.length}`);
      assert.ok(seo.title.length <= 75, `${id} title too long: ${seo.title.length}`);
    }
  }
});

test('the H1 always agrees with the title intent', () => {
  const pairs = [
    ['bugun', /Bugün/],
    ['yarin', /Yarın/],
    ['7gun', /7 Günlük/],
    ['10gun', /10 Günlük/],
    ['15gun', /15 Günlük/],
    ['saatlik', /Saatlik/],
  ];
  for (const [id, re] of pairs) {
    const seo = getPeriodSEO(KOCAELI, id);
    assert.match(seo.heading, re, `H1 for ${id}`);
    assert.match(seo.title, re, `title for ${id}`);
  }
});

test('"Merkez" districts are named after their province', () => {
  const names = getLocationNames({
    provinceName: 'Adıyaman', provinceSlug: 'adiyaman',
    districtName: 'Merkez', districtSlug: 'adiyaman-merkez', lat: 0, lon: 0,
  });
  assert.equal(names.short, 'Adıyaman Merkez');
  assert.equal(names.qualified, 'Adıyaman Merkez');
});

test('district titles carry the province so shared names stay distinct', () => {
  const golbasiAdiyaman = getPeriodSEO(
    { provinceName: 'Adıyaman', provinceSlug: 'adiyaman', districtName: 'Gölbaşı', districtSlug: 'golbasi', lat: 0, lon: 0 },
    '15gun',
  );
  const golbasiAnkara = getPeriodSEO(
    { provinceName: 'Ankara', provinceSlug: 'ankara', districtName: 'Gölbaşı', districtSlug: 'golbasi-ankara', lat: 0, lon: 0 },
    '15gun',
  );
  assert.notEqual(golbasiAdiyaman.title, golbasiAnkara.title);
  assert.match(golbasiAdiyaman.title, /Adıyaman/);
  assert.match(golbasiAnkara.title, /Ankara/);
});

test('breadcrumbs are absolute and end at the current page', () => {
  const crumbs = buildBreadcrumbs(IZMIT, '15gun', 'Marmara Bölgesi');
  for (const c of crumbs) {
    assert.match(c.url, /^https:\/\/yarinhava\.com\//, c.url);
  }
  assert.equal(crumbs.at(-1).url, getCanonicalForPeriod('kocaeli', '15gun', 'i-zmit'));
});

test('every period definition is internally consistent', () => {
  for (const [id, def] of Object.entries(PERIOD_DEFS)) {
    assert.equal(def.id, id);
    assert.ok(def.dayStart >= 0);
    assert.ok(def.dayCount >= 0);
    if (def.dayCount > 0) assert.ok(def.dailyTitle.length > 0, `${id} needs a daily title`);
    if (def.hourly) {
      assert.ok(def.hourly[0] < def.hourly[1], id);
      assert.ok(def.hourlyTitle, `${id} needs an hourly title`);
    }
  }
  // Slugs must be unique and URL-safe.
  const slugs = PERIODS.map((p) => p.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const s of slugs) assert.match(s, /^[a-z0-9-]+$/);
});
