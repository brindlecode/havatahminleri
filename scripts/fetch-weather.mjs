import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(__dirname, '..', 'src', 'data', 'weather-cache.json');
const BASE_URL = 'https://api.open-meteo.com/v1/forecast';

// Fetch config - tuned for Open-Meteo free tier (600 req/min)
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 1200; // 10 req per 1.2s = ~500 req/min (safe under 600 limit)
const TIMEOUT_MS = 12000;
const MAX_RETRIES = 4;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const API_FIELDS = {
  current:
    'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,is_day,surface_pressure,cloud_cover,visibility',
  hourly:
    'temperature_2m,weather_code,relative_humidity_2m,precipitation_probability,wind_speed_10m,is_day,dew_point_2m,visibility,surface_pressure,cloud_cover',
  daily:
    'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,uv_index_max,sunrise,sunset',
  timezone: 'Europe/Istanbul',
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
        const wait = attempt * 5000;
        console.warn(`  Rate limited, waiting ${wait / 1000}s...`);
        await delay(wait);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      return parseResponse(await res.json());
    } catch (err) {
      if (attempt === MAX_RETRIES) return null;
      await delay(2000 * attempt);
    }
  }
  return null;
}

async function main() {
  const t0 = Date.now();
  console.log('[WEATHER] Pre-build fetch starting...');

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

  for (let i = 0; i < locations.length; i += BATCH_SIZE) {
    const batch = locations.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async ([key, { lat, lon }]) => ({ key, data: await fetchOne(lat, lon) })),
    );

    for (const { key, data } of batchResults) {
      if (data) {
        results[key] = data;
        ok++;
      } else {
        fail++;
      }
    }

    const done = Math.min(i + BATCH_SIZE, locations.length);
    process.stdout.write(`\r[WEATHER] ${done}/${locations.length} (${ok} ok, ${fail} fail)`);

    if (i + BATCH_SIZE < locations.length) await delay(BATCH_DELAY_MS);
  }
  console.log('');

  // If API completely unreachable, try existing cache
  if (ok === 0) {
    if (existsSync(CACHE_PATH)) {
      console.log('[WEATHER] API unreachable - reusing existing cache');
      return;
    }
    console.error('[WEATHER] FATAL: No data fetched and no existing cache');
    process.exit(1);
  }

  // Fill gaps from existing cache
  if (fail > 0 && existsSync(CACHE_PATH)) {
    try {
      const old = JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
      let filled = 0;
      for (const [key] of locations) {
        if (!results[key] && old.data?.[key]) {
          results[key] = old.data[key];
          filled++;
        }
      }
      if (filled) console.log(`[WEATHER] Filled ${filled} gaps from previous cache`);
    } catch {}
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
  if (existsSync(CACHE_PATH)) {
    console.log('[WEATHER] Falling back to existing cache');
  } else {
    process.exit(1);
  }
});
