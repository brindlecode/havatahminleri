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
    weatherCode: [],
    humidity: [],
    precipitationProbability: [],
    windSpeed: [],
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
    hourly.weatherCode.push(CODES[Math.floor(w * CODES.length)]);
    hourly.humidity.push(Math.round(40 + w * 55));
    hourly.precipitationProbability.push(Math.round(w * 100));
    hourly.windSpeed.push(Math.round((3 + w * 28) * 10) / 10);
    hourly.isDay.push(hourOfDay >= 7 && hourOfDay < 19 ? 1 : 0);
    hourly.dewPoint.push(Math.round((base - 6 + w * 4) * 10) / 10);
    hourly.visibility.push(Math.round(4000 + w * 20000));
    hourly.pressure.push(Math.round((995 + w * 30) * 10) / 10);
    hourly.cloudCover.push(Math.round(w * 100));
  }

  return {
    current: {
      temperature: hourly.temperature[0],
      weatherCode: daily.weatherCode[0],
      windSpeed: hourly.windSpeed[0],
      windDirection: Math.round(r * 359),
      humidity: hourly.humidity[0],
      apparentTemperature: Math.round((hourly.temperature[0] - 1 + r * 3) * 10) / 10,
      isDay: hourly.isDay[0] === 1,
      pressure: hourly.pressure[0],
      cloudCover: hourly.cloudCover[0],
      visibility: hourly.visibility[0],
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
