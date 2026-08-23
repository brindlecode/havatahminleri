import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(__dirname, '..', 'src', 'data', 'weather-cache.json');
const BASE_URL = 'https://api.open-meteo.com/v1/forecast';

// Fetch config - tuned for Open-Meteo free tier (600 req/min)
const INITIAL_BATCH_SIZE = 5;
const THROTTLED_BATCH_SIZE = 2;
const INITIAL_BATCH_DELAY_MS = 2500;
const TIMEOUT_MS = 12000;
const MAX_RETRIES = 2;
const CONSECUTIVE_FAIL_LIMIT = 15; // Stop after this many consecutive fails
const MIN_COVERAGE = 0.5; // Refuse to publish if fewer locations than this have fresh data

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

const API_FIELDS = {
  current:
    'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,is_day,surface_pressure,cloud_cover,visibility',
  hourly:
    'temperature_2m,weather_code,relative_humidity_2m,precipitation_probability,wind_speed_10m,is_day,dew_point_2m,visibility,surface_pressure,cloud_cover',
  daily:
    'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,uv_index_max,sunrise,sunset',
  timezone: TIMEZONE,
  forecast_days: '16',
  forecast_hours: '48',
};

function parseResponse(d) {
  return {
    current: {
      temperature: d.current.temperature_2m,
      weatherCode: d.current.weather_code,
      windSpeed: d.current.wind_speed_10m,
      windDirection: d.current.wind_direction_10m,
      humidity: d.current.relative_humidity_2m,
      apparentTemperature: d.current.apparent_temperature,
      isDay: d.current.is_day === 1,
      pressure: d.current.surface_pressure ?? 1013,
      cloudCover: d.current.cloud_cover ?? 0,
      visibility: d.current.visibility ?? 10000,
    },
    hourly: {
      time: d.hourly.time,
      temperature: d.hourly.temperature_2m,
      weatherCode: d.hourly.weather_code,
      humidity: d.hourly.relative_humidity_2m,
      precipitationProbability: d.hourly.precipitation_probability,
      windSpeed: d.hourly.wind_speed_10m,
      isDay: d.hourly.is_day,
      dewPoint: d.hourly.dew_point_2m ?? [],
      visibility: d.hourly.visibility ?? [],
      pressure: d.hourly.surface_pressure ?? [],
      cloudCover: d.hourly.cloud_cover ?? [],
    },
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
async function fetchOne(lat, lon) {
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

      return { data: parseResponse(await res.json()), rateLimited: false };
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

  const locations = [...locMap.entries()];
  console.log(`[WEATHER] ${locations.length} unique locations`);

  const results = {};
  let ok = 0;
  let fail = 0;
  let consecutiveFails = 0;
  let batchSize = INITIAL_BATCH_SIZE;
  let batchDelay = INITIAL_BATCH_DELAY_MS;
  let throttled = false;

  for (let i = 0; i < locations.length; i += batchSize) {
    const batch = locations.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async ([key, { lat, lon }]) => {
        const result = await fetchOne(lat, lon);
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
        fail++;
        consecutiveFails++;
      }
    }

    const done = Math.min(i + batchSize, locations.length);
    process.stdout.write(`\r[WEATHER] ${done}/${locations.length} (${ok} ok, ${fail} fail)`);

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

    if (i + batchSize < locations.length && !batchRateLimited) {
      await delay(batchDelay);
    }
  }
  console.log('');

  // If API completely unreachable, the previous cache may only be reused
  // while it still covers today - never publish a forecast that starts in
  // the past.
  if (ok === 0) {
    const usable = freshCount(readCache(), day);
    if (usable > 0) {
      console.log(`[WEATHER] API unreachable - reusing today's cache (${usable} locations)`);
      return;
    }
    console.error(
      `[WEATHER] FATAL: no data fetched and no cached forecast for ${day} - refusing to publish stale dates`,
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
      `[WEATHER] FATAL: only ${covered}/${locations.length} locations ` +
        `(${(coverage * 100).toFixed(1)}%) have current data - refusing to publish a degraded build`,
    );
    process.exit(1);
  }

  writeFileSync(
    CACHE_PATH,
    JSON.stringify({ fetchedAt: new Date().toISOString(), data: results }),
  );

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[WEATHER] Done: ${Object.keys(results).length} locations cached in ${elapsed}s`);
}

main().catch((err) => {
  console.error('[WEATHER] Error:', err.message);
  const day = today();
  const usable = freshCount(readCache(), day);
  if (usable > 0) {
    console.log(`[WEATHER] Falling back to today's existing cache (${usable} locations)`);
  } else {
    console.error(`[WEATHER] No cached forecast for ${day} - aborting build`);
    process.exit(1);
  }
});
