import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argValue = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? argv[i + 1] : undefined;
};
// `--sample N --out file` fetches only N locations: a cheap check, run on pull
// requests, that the Open-Meteo request and response shape still match what
// this script expects - without spending the daily API budget.
const SAMPLE = Number(argValue('sample') ?? 0);
const CACHE_PATH = argValue('out') ?? join(__dirname, '..', 'src', 'data', 'weather-cache.json');
const BASE_URL = 'https://api.open-meteo.com/v1/forecast';

// Fetch config - tuned for Open-Meteo free tier (600 req/min)
const INITIAL_BATCH_SIZE = 5;
const THROTTLED_BATCH_SIZE = 2;
const INITIAL_BATCH_DELAY_MS = 2500;
const TIMEOUT_MS = 12000;
const MAX_RETRIES = 2;
const CONSECUTIVE_FAIL_LIMIT = 15; // Stop after this many consecutive fails

/**
 * Refuse to publish unless this share of locations has data fetched for today.
 *
 * Anything missing falls back to the nearest cached location at render time,
 * so a low-coverage build quietly shows one city's weather on another city's
 * page. Failing the build instead leaves the last good deploy up, opens an
 * issue, and lets the health check escalate if the outage persists - all of
 * which are louder than shipping wrong forecasts.
 */
const MIN_COVERAGE = 0.85;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const TIMEZONE = 'Europe/Istanbul';

// Today's date as YYYY-MM-DD in the forecast timezone
function today() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// A cached entry is only usable while its forecast still starts today -
// otherwise the site would publish past dates labelled "Bugün".
function isFresh(entry, day) {
  return entry?.daily?.time?.[0] === day;
}

function readCache() {
  if (!existsSync(CACHE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function freshCount(cache, day) {
  return Object.values(cache?.data ?? {}).filter((entry) => isFresh(entry, day)).length;
}

/**
 * The site is rebuilt once a day, just after midnight Turkey time, so there is
 * no `current` block: "current conditions" fetched at 00:05 would be midnight
 * values shown all day. Instead the hourly series (which starts at 00:00
 * today) is kept, and the "current" card is derived from it - statically from
 * the noon hour, and in the browser from the visitor's actual hour
 * (public/scripts/weather-now.js).
 *
 * `forecast_hours` is deliberately NOT used: with it, Open-Meteo starts the
 * hourly series at the current hour, while every consumer of this cache
 * indexes the series as "0 = today 00:00, 24 = tomorrow 00:00".
 */
const HOURLY_HOURS = 48;
const NOON = 12;

const API_FIELDS = {
  hourly:
    'temperature_2m,apparent_temperature,weather_code,relative_humidity_2m,precipitation_probability,wind_speed_10m,wind_direction_10m,is_day,visibility,surface_pressure,cloud_cover',
  daily:
    'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,uv_index_max,sunrise,sunset',
  timezone: TIMEZONE,
  forecast_days: '16',
};

const take = (arr, n) => (Array.isArray(arr) ? arr.slice(0, n) : []);

/** Returns null when the response does not start at 00:00 on `day`. */
function parseResponse(d, day) {
  const h = d.hourly;
  if (!h?.time?.length || h.time[0] !== `${day}T00:00`) return null;
  const n = Math.min(HOURLY_HOURS, h.time.length);
  const hourly = {
    time: take(h.time, n),
    temperature: take(h.temperature_2m, n),
    apparentTemperature: take(h.apparent_temperature, n),
    weatherCode: take(h.weather_code, n),
    humidity: take(h.relative_humidity_2m, n),
    precipitationProbability: take(h.precipitation_probability, n),
    windSpeed: take(h.wind_speed_10m, n),
    windDirection: take(h.wind_direction_10m, n),
    isDay: take(h.is_day, n),
    dewPoint: [],
    visibility: take(h.visibility, n),
    pressure: take(h.surface_pressure, n),
    cloudCover: take(h.cloud_cover, n),
  };
  const i = Math.min(NOON, n - 1);
  return {
    current: {
      temperature: hourly.temperature[i],
      weatherCode: hourly.weatherCode[i],
      windSpeed: hourly.windSpeed[i],
      windDirection: hourly.windDirection[i] ?? 0,
      humidity: hourly.humidity[i],
      apparentTemperature: hourly.apparentTemperature[i] ?? hourly.temperature[i],
      isDay: hourly.isDay[i] === 1,
      pressure: hourly.pressure[i] ?? 1013,
      cloudCover: hourly.cloudCover[i] ?? 0,
      visibility: hourly.visibility[i] ?? 10000,
      hour: hourly.time[i],
    },
    hourly,
    daily: {
      time: d.daily.time,
      weatherCode: d.daily.weather_code,
      temperatureMax: d.daily.temperature_2m_max,
      temperatureMin: d.daily.temperature_2m_min,
      precipitationSum: d.daily.precipitation_sum,
      precipitationProbabilityMax: d.daily.precipitation_probability_max,
      windSpeedMax: d.daily.wind_speed_10m_max,
      uvIndexMax: d.daily.uv_index_max,
      sunrise: d.daily.sunrise,
      sunset: d.daily.sunset,
    },
  };
}

// Returns { data, rateLimited }
async function fetchOne(lat, lon, day) {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    ...API_FIELDS,
  });
  const url = `${BASE_URL}?${params}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      if (res.status === 429) {
        // Signal rate limit to caller - don't retry here, let batch handle it
        return { data: null, rateLimited: true };
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = parseResponse(await res.json(), day);
      if (!data) throw new Error('hourly series does not start at 00:00 today');
      return { data, rateLimited: false };
    } catch (err) {
      if (attempt === MAX_RETRIES) return { data: null, rateLimited: false };
      await delay(2000 * attempt);
    }
  }
  return { data: null, rateLimited: false };
}

async function main() {
  const t0 = Date.now();
  const day = today();
  console.log(`[WEATHER] Pre-build fetch starting for ${day}...`);

  const provinces = JSON.parse(
    readFileSync(join(__dirname, '..', 'src', 'data', 'provinces.json'), 'utf-8'),
  );
  const districts = JSON.parse(
    readFileSync(join(__dirname, '..', 'src', 'data', 'districts.json'), 'utf-8'),
  );

  // Collect unique locations by cache key
  const locMap = new Map();
  for (const p of provinces) {
    locMap.set(`${p.lat.toFixed(2)}_${p.lon.toFixed(2)}`, { lat: p.lat, lon: p.lon });
  }
  for (const d of districts) {
    const key = `${d.lat.toFixed(2)}_${d.lon.toFixed(2)}`;
    if (!locMap.has(key)) locMap.set(key, { lat: d.lat, lon: d.lon });
  }

  const allLocations = [...locMap.entries()];
  const locations = SAMPLE > 0 ? allLocations.slice(0, SAMPLE) : allLocations;
  console.log(`[WEATHER] ${locations.length} unique locations`);

  const results = {};
  const failedKeys = new Set();
  let ok = 0;
  let fail = 0;
  let consecutiveFails = 0;
  let batchSize = INITIAL_BATCH_SIZE;
  let batchDelay = INITIAL_BATCH_DELAY_MS;
  let throttled = false;

  // An explicit cursor: batchSize is adjusted inside the loop by the adaptive
  // throttle, so `i += batchSize` would skip or re-fetch locations whenever it
  // changed mid-iteration.
  for (let i = 0; i < locations.length; ) {
    const batch = locations.slice(i, i + batchSize);
    const consumed = batch.length;
    const batchResults = await Promise.all(
      batch.map(async ([key, { lat, lon }]) => {
        const result = await fetchOne(lat, lon, day);
        return { key, ...result };
      }),
    );

    let batchRateLimited = false;
    let batchOk = 0;

    for (const { key, data, rateLimited } of batchResults) {
      if (rateLimited) batchRateLimited = true;
      if (data) {
        results[key] = data;
        ok++;
        batchOk++;
        consecutiveFails = 0;
      } else {
        failedKeys.add(key);
        fail++;
        consecutiveFails++;
      }
    }

    i += consumed;
    process.stdout.write(`\r[WEATHER] ${i}/${locations.length} (${ok} ok, ${fail} fail)`);

    // Adaptive throttling
    if (batchRateLimited) {
      if (!throttled) {
        console.log('\n[WEATHER] Rate limit detected - throttling down');
        throttled = true;
      }
      batchSize = THROTTLED_BATCH_SIZE;
      batchDelay = Math.min(batchDelay * 2, 30000); // Double delay, max 30s
      console.log(`  Backing off: batch=${batchSize}, delay=${batchDelay / 1000}s`);
      await delay(batchDelay);
    } else if (throttled && batchOk === batchSize) {
      // Gradually recover if batch was fully successful
      batchDelay = Math.max(batchDelay * 0.75, INITIAL_BATCH_DELAY_MS);
      if (batchDelay <= INITIAL_BATCH_DELAY_MS * 2) {
        batchSize = Math.min(batchSize + 1, INITIAL_BATCH_SIZE);
      }
    }

    // Early exit if too many consecutive failures
    if (consecutiveFails >= CONSECUTIVE_FAIL_LIMIT) {
      console.log(`\n[WEATHER] ${consecutiveFails} consecutive failures - stopping fetch early`);
      break;
    }

    if (i < locations.length && !batchRateLimited) {
      await delay(batchDelay);
    }
  }
  console.log('');

  // One slow second pass over whatever failed (usually HTTP 429 bursts), so a
  // brief rate limit does not cost coverage for the whole day.
  if (ok > 0 && failedKeys.size > 0 && failedKeys.size <= locations.length * 0.3) {
    console.log(`[WEATHER] Retrying ${failedKeys.size} failed locations after a pause...`);
    await delay(60000);
    const byKey = new Map(locations);
    for (const key of [...failedKeys]) {
      const { lat, lon } = byKey.get(key);
      const { data } = await fetchOne(lat, lon, day);
      if (data) {
        results[key] = data;
        failedKeys.delete(key);
        ok++;
        fail--;
      }
      await delay(1500);
    }
    console.log(`[WEATHER] After retry: ${ok} ok, ${fail} fail`);
  }

  // If API completely unreachable, the previous cache may only be reused
  // while it still covers today - never publish a forecast that starts in
  // the past.
  if (ok === 0) {
    const cached = readCache();
    const usable = freshCount(cached, day);
    // Only reuse a cache that still covers today AND covers enough of the
    // country; otherwise most pages would render a distant city's forecast.
    if (usable / locations.length >= MIN_COVERAGE) {
      console.log(`[WEATHER] API unreachable - reusing today's cache (${usable} locations)`);
      return;
    }
    console.error(
      `::error::[WEATHER] FATAL: no data fetched and only ${usable}/${locations.length} cached ` +
        `locations cover ${day} - refusing to publish stale or degraded forecasts`,
    );
    process.exit(1);
  }

  // Fill gaps from existing cache, skipping anything that is no longer current
  if (fail > 0) {
    const old = readCache();
    if (old) {
      let filled = 0;
      let stale = 0;
      for (const [key] of locations) {
        if (results[key]) continue;
        const prev = old.data?.[key];
        if (isFresh(prev, day)) {
          results[key] = prev;
          filled++;
        } else if (prev) {
          stale++;
        }
      }
      if (filled) console.log(`[WEATHER] Filled ${filled} gaps from previous cache`);
      if (stale) console.log(`[WEATHER] Dropped ${stale} stale cache entries (not from ${day})`);
    }
  }

  // A heavily degraded fetch would fall back to far-away locations for most
  // cities. Fail the build instead so the outage is visible and the last
  // good deploy stays up.
  const covered = Object.keys(results).length;
  const coverage = covered / locations.length;
  if (coverage < MIN_COVERAGE) {
    console.error(
      `::error::[WEATHER] FATAL: only ${covered}/${locations.length} locations ` +
        `(${(coverage * 100).toFixed(1)}%, minimum ${(MIN_COVERAGE * 100).toFixed(0)}%) have current data - ` +
        'refusing to publish a degraded build. The last good deploy stays live.',
    );
    process.exit(1);
  }

  // Every entry written must start today. A single stale entry would render a
  // past date under "Bugün" on that location's pages.
  const stale = Object.entries(results).filter(([, v]) => !isFresh(v, day));
  if (stale.length) {
    console.error(
      `::error::[WEATHER] FATAL: ${stale.length} entries do not start on ${day} ` +
        `(e.g. ${stale[0][0]} starts ${stale[0][1]?.daily?.time?.[0]})`,
    );
    process.exit(1);
  }

  writeFileSync(
    CACHE_PATH,
    JSON.stringify({
      fetchedAt: new Date().toISOString(),
      forecastStart: day,
      coverage: Math.round(coverage * 1000) / 1000,
      locationCount: covered,
      data: results,
    }),
  );

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `[WEATHER] Done: ${covered}/${locations.length} locations (${(coverage * 100).toFixed(1)}%) ` +
      `for ${day} cached in ${elapsed}s`,
  );
}

main().catch((err) => {
  console.error('[WEATHER] Error:', err.message);
  const day = today();
  const cache = readCache();
  const usable = freshCount(cache, day);
  const total = Object.keys(cache?.data ?? {}).length || 1;
  if (usable / total >= MIN_COVERAGE) {
    console.log(`[WEATHER] Falling back to today's existing cache (${usable} locations)`);
  } else {
    console.error(
      `::error::[WEATHER] Only ${usable}/${total} cached locations cover ${day} - aborting build`,
    );
    process.exit(1);
  }
});
