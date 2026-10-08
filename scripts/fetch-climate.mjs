import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Monthly climate normals per province for the "iklim" pages, from ten years
 * (2015-2024) of ERA5 reanalysis via the Open-Meteo Historical Weather API.
 * The result is small (81 x 12 rows) and is committed to the repository as
 * src/data/climate.json by .github/workflows/climate.yml; the site build only
 * reads it.
 *
 * Budget: ten years of daily data for one location counts as ~260 Open-Meteo
 * calls, and the forecast builds already use about half of the 10,000 daily
 * calls. So each run only fills in provinces still missing (--limit, default
 * 14), waits between requests to stay under the 600/minute limit, stops at
 * the first HTTP 429 and writes whatever it has. Re-running is safe; the
 * pages for a province appear once its row exists.
 *
 *   node scripts/fetch-climate.mjs [--limit N] [--probe]
 *
 * --probe fetches one year for Ankara and prints the result without writing.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argValue = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? argv[i + 1] : undefined;
};
const OUT = argValue('out') ?? join(__dirname, '..', 'src', 'data', 'climate.json');
const LIMIT = Number(argValue('limit') ?? 14);
const PROBE = argv.includes('--probe');
const URL_BASE = 'https://archive-api.open-meteo.com/v1/archive';
const START_YEAR = 2015;
const END_YEAR = 2024;
const DAILY = [
  'temperature_2m_max',
  'temperature_2m_min',
  'temperature_2m_mean',
  'precipitation_sum',
  'snowfall_sum',
  'sunshine_duration',
  'wind_speed_10m_max',
];
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[CLIMATE]', ...a);
const r1 = (v) => Math.round(v * 10) / 10;

/**
 * Daily series -> 12 monthly rows. Means are over all days of that month in
 * the period; precipitation is the mean monthly total; "days" are mean counts
 * per month; records carry their year.
 */
export function aggregate(daily) {
  const months = Array.from({ length: 12 }, () => ({
    hi: [], lo: [], mean: [], sun: [], wind: [],
    precipByYear: new Map(), rainyByYear: new Map(), snowyByYear: new Map(), hotByYear: new Map(), frostByYear: new Map(),
    recHi: -Infinity, recHiYear: 0, recLo: Infinity, recLoYear: 0,
  }));
  const bump = (map, y, v) => map.set(y, (map.get(y) ?? 0) + v);
  daily.time.forEach((t, i) => {
    const y = Number(t.slice(0, 4));
    const m = months[Number(t.slice(5, 7)) - 1];
    const hi = daily.temperature_2m_max[i];
    const lo = daily.temperature_2m_min[i];
    if (hi == null || lo == null) return;
    m.hi.push(hi);
    m.lo.push(lo);
    m.mean.push(daily.temperature_2m_mean?.[i] ?? (hi + lo) / 2);
    if (daily.sunshine_duration?.[i] != null) m.sun.push(daily.sunshine_duration[i] / 3600);
    if (daily.wind_speed_10m_max?.[i] != null) m.wind.push(daily.wind_speed_10m_max[i]);
    const p = daily.precipitation_sum?.[i] ?? 0;
    bump(m.precipByYear, y, p);
    bump(m.rainyByYear, y, p >= 1 ? 1 : 0);
    bump(m.snowyByYear, y, (daily.snowfall_sum?.[i] ?? 0) >= 0.5 ? 1 : 0);
    bump(m.hotByYear, y, hi >= 30 ? 1 : 0);
    bump(m.frostByYear, y, lo < 0 ? 1 : 0);
    if (hi > m.recHi) { m.recHi = hi; m.recHiYear = y; }
    if (lo < m.recLo) { m.recLo = lo; m.recLoYear = y; }
  });
  const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
  const perYear = (map) => avg([...map.values()]);
  return months.map((m) => ({
    hi: r1(avg(m.hi)),
    lo: r1(avg(m.lo)),
    mean: r1(avg(m.mean)),
    precip: Math.round(perYear(m.precipByYear)),
    rainyDays: r1(perYear(m.rainyByYear)),
    snowyDays: r1(perYear(m.snowyByYear)),
    hotDays: r1(perYear(m.hotByYear)),
    frostDays: r1(perYear(m.frostByYear)),
    sunHours: r1(avg(m.sun)),
    windMax: Math.round(avg(m.wind)),
    recordHi: r1(m.recHi),
    recordHiYear: m.recHiYear,
    recordLo: r1(m.recLo),
    recordLoYear: m.recLoYear,
  }));
}

async function fetchProvince(p, start, end) {
  const params = new URLSearchParams({
    latitude: p.lat.toFixed(3),
    longitude: p.lon.toFixed(3),
    start_date: start,
    end_date: end,
    daily: DAILY.join(','),
    timezone: 'Europe/Istanbul',
  });
  const res = await fetch(`${URL_BASE}?${params}`, { signal: AbortSignal.timeout(60000) });
  if (res.status === 429) return { rateLimited: true };
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const d = await res.json();
  if (!d.daily?.time?.length) throw new Error('no daily series');
  return { daily: d.daily };
}

async function main() {
  const provinces = JSON.parse(readFileSync(join(__dirname, '..', 'src', 'data', 'provinces.json'), 'utf-8'));

  if (PROBE) {
    const ankara = provinces.find((p) => p.plate === 6);
    const r = await fetchProvince(ankara, '2024-01-01', '2024-12-31');
    log(`probe: ${r.daily?.time?.length ?? 0} days, keys ${Object.keys(r.daily ?? {}).join(',')}`);
    if (r.daily) log('probe months:', JSON.stringify(aggregate(r.daily).map((m) => [m.lo, m.hi, m.precip, m.rainyDays, m.sunHours])));
    return;
  }

  const data = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf-8')) : {};
  data.period = `${START_YEAR}-${END_YEAR}`;
  data.source = 'Open-Meteo Historical Weather API (ERA5)';
  data.provinces ??= {};
  const todo = provinces.filter((p) => !data.provinces[p.plate]);
  log(`${Object.keys(data.provinces).length}/81 provinces done, fetching up to ${LIMIT} of ${todo.length}`);

  let done = 0;
  for (const p of todo.slice(0, LIMIT)) {
    try {
      const r = await fetchProvince(p, `${START_YEAR}-01-01`, `${END_YEAR}-12-31`);
      if (r.rateLimited) {
        log('HTTP 429 - stopping for today');
        break;
      }
      data.provinces[p.plate] = aggregate(r.daily);
      done++;
      log(`${p.name}: ok (${r.daily.time.length} days)`);
    } catch (err) {
      log(`${p.name}: ${err.message}`);
    }
    // ~260 weighted calls per request against a 600/minute limit.
    await delay(35000);
  }
  data.updatedAt = new Date().toISOString();
  writeFileSync(OUT, `${JSON.stringify(data)}\n`);
  log(`wrote ${done} new provinces; ${Object.keys(data.provinces).length}/81 total`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
