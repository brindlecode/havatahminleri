#!/usr/bin/env node
/**
 * Builds a deterministic, synthetic weather cache with the exact shape of the
 * real one written by scripts/fetch-weather.mjs.
 *
 * This exists so the site can be built and validated without network access
 * (offline dev, sandboxed CI, unit tests). It is NEVER used by the production
 * workflow, which always runs scripts/fetch-weather.mjs against Open-Meteo.
 *
 * Usage: node scripts/make-fixture-cache.mjs [--out <path>]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, '..', 'src', 'data');

const outFlag = process.argv.indexOf('--out');
const OUT = outFlag > -1 ? process.argv[outFlag + 1] : join(DATA, 'weather-cache.json');

const TIMEZONE = 'Europe/Istanbul';
const FORECAST_DAYS = 16;
const FORECAST_HOURS = 48;

function todayISO() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// Small deterministic hash so every location gets stable but distinct numbers.
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

const CODES = [0, 1, 2, 3, 45, 51, 61, 63, 80, 95];

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function buildEntry(key, day) {
  const r = hash(key);
  const base = 8 + r * 22; // 8..30 °C

  const daily = {
    time: [],
    weatherCode: [],
    temperatureMax: [],
    temperatureMin: [],
    precipitationSum: [],
    precipitationProbabilityMax: [],
    windSpeedMax: [],
    uvIndexMax: [],
    sunrise: [],
    sunset: [],
  };

  for (let i = 0; i < FORECAST_DAYS; i++) {
    const w = hash(`${key}:${i}`);
    const date = addDays(day, i);
    const max = Math.round((base + 6 + Math.sin(i / 2.2) * 4 + w * 3) * 10) / 10;
    daily.time.push(date);
    daily.weatherCode.push(CODES[Math.floor(w * CODES.length)]);
    daily.temperatureMax.push(max);
    daily.temperatureMin.push(Math.round((max - 7 - w * 3) * 10) / 10);
    daily.precipitationSum.push(w > 0.7 ? Math.round(w * 90) / 10 : 0);
    daily.precipitationProbabilityMax.push(Math.round(w * 100));
    daily.windSpeedMax.push(Math.round((5 + w * 30) * 10) / 10);
    daily.uvIndexMax.push(Math.round(w * 9 * 10) / 10);
    daily.sunrise.push(`${date}T0${5 + Math.floor(w * 2)}:${pad(Math.floor(w * 59))}`);
    daily.sunset.push(`${date}T1${8 + Math.floor(w * 1)}:${pad(Math.floor(w * 59))}`);
  }

  const hourly = {
    time: [],
    temperature: [],
    apparentTemperature: [],
    weatherCode: [],
    humidity: [],
    precipitationProbability: [],
    windSpeed: [],
    windDirection: [],
    isDay: [],
    dewPoint: [],
    visibility: [],
    pressure: [],
    cloudCover: [],
  };

  for (let i = 0; i < FORECAST_HOURS; i++) {
    const w = hash(`${key}:h:${i}`);
    const hourOfDay = i % 24;
    const date = addDays(day, Math.floor(i / 24));
    hourly.time.push(`${date}T${pad(hourOfDay)}:00`);
    hourly.temperature.push(
      Math.round((base + Math.sin(((hourOfDay - 4) / 24) * Math.PI * 2) * 6 + w * 2) * 10) / 10,
    );
    hourly.apparentTemperature.push(
      Math.round((hourly.temperature[i] - 1 + w * 3) * 10) / 10,
    );
    hourly.weatherCode.push(CODES[Math.floor(w * CODES.length)]);
    hourly.humidity.push(Math.round(40 + w * 55));
    hourly.precipitationProbability.push(Math.round(w * 100));
    hourly.windSpeed.push(Math.round((3 + w * 28) * 10) / 10);
    hourly.windDirection.push(Math.round(w * 359));
    hourly.isDay.push(hourOfDay >= 7 && hourOfDay < 19 ? 1 : 0);
    hourly.dewPoint.push(Math.round((base - 6 + w * 4) * 10) / 10);
    hourly.visibility.push(Math.round(4000 + w * 20000));
    hourly.pressure.push(Math.round((995 + w * 30) * 10) / 10);
    hourly.cloudCover.push(Math.round(w * 100));
  }

  // Same derivation as scripts/fetch-weather.mjs: "current" is today's noon.
  const n = 12;
  return {
    current: {
      temperature: hourly.temperature[n],
      weatherCode: hourly.weatherCode[n],
      windSpeed: hourly.windSpeed[n],
      windDirection: hourly.windDirection[n],
      humidity: hourly.humidity[n],
      apparentTemperature: hourly.apparentTemperature[n],
      isDay: hourly.isDay[n] === 1,
      pressure: hourly.pressure[n],
      cloudCover: hourly.cloudCover[n],
      visibility: hourly.visibility[n],
      hour: hourly.time[n],
    },
    hourly,
    daily,
  };
}

const provinces = JSON.parse(readFileSync(join(DATA, 'provinces.json'), 'utf-8'));
const districts = JSON.parse(readFileSync(join(DATA, 'districts.json'), 'utf-8'));

const keys = new Set();
for (const p of provinces) keys.add(`${p.lat.toFixed(2)}_${p.lon.toFixed(2)}`);
for (const d of districts) keys.add(`${d.lat.toFixed(2)}_${d.lon.toFixed(2)}`);

const day = todayISO();
const data = {};
for (const key of keys) data[key] = buildEntry(key, day);

writeFileSync(
  OUT,
  JSON.stringify({ fetchedAt: new Date().toISOString(), synthetic: true, data }),
);

console.log(`[FIXTURE] Wrote ${keys.size} synthetic locations for ${day} to ${OUT}`);
console.log('[FIXTURE] THIS IS NOT REAL WEATHER DATA - never deploy a build made from it.');

// Synthetic air quality and sea temperature in the shape scripts/fetch-extras.mjs
// writes, so the boxes and pages that use them are built and validated
// offline too. Only next to the real cache location, never with --out.
if (outFlag === -1) {
  const coastal = JSON.parse(readFileSync(join(DATA, 'coastalPoints.json'), 'utf-8')).points;
  const hours = Array.from({ length: 48 }, (_, i) => `${addDays(day, Math.floor(i / 24))}T${pad(i % 24)}:00`);
  const air = {};
  for (const p of provinces) {
    const r = hash(`aq${p.plate}`);
    const base = 10 + r * 60;
    air[p.plate] = {
      time: hours,
      aqi: hours.map((_, i) => Math.round(base + 12 * Math.sin(((i % 24) - 6) / 3.8))),
      pm25: hours.map(() => Math.round(base * 0.5)),
      pm10: hours.map(() => Math.round(base * 0.8)),
    };
  }
  const sea = {};
  for (const pt of coastal) {
    const t = 17 + hash(`sea${pt.plate}`) * 11;
    sea[pt.plate] = { time: hours, sst: hours.map((_, i) => Math.round((t + 0.4 * Math.sin(i / 4)) * 10) / 10), waveMax: [0.4, 0.8] };
  }
  const extras = { fetchedAt: new Date().toISOString(), day, synthetic: true, air, sea, warnings: { source: '', ok: false, items: [] } };
  writeFileSync(join(DATA, 'extras-cache.json'), JSON.stringify(extras));
  console.log(`[FIXTURE] Wrote synthetic air quality (${provinces.length}) and sea (${coastal.length}) data`);
}
