export interface CurrentWeather {
  temperature: number;
  weatherCode: number;
  windSpeed: number;
  windDirection: number;
  humidity: number;
  apparentTemperature: number;
  isDay: boolean;
  pressure: number;
  cloudCover: number;
  visibility: number;
  /**
   * The hour these values describe ("2026-09-26T12:00"). The site is built
   * once a day at midnight, so "current" is the forecast for noon today, not a
   * live observation; the browser swaps in the visitor's actual hour.
   */
  hour?: string;
}

export interface HourlyForecast {
  time: string[];
  temperature: number[];
  apparentTemperature?: number[];
  windDirection?: number[];
  weatherCode: number[];
  humidity: number[];
  precipitationProbability: number[];
  windSpeed: number[];
  isDay: number[];
  dewPoint: number[];
  visibility: number[];
  pressure: number[];
  cloudCover: number[];
}

export interface DailyForecast {
  time: string[];
  weatherCode: number[];
  temperatureMax: number[];
  temperatureMin: number[];
  precipitationSum: number[];
  precipitationProbabilityMax: number[];
  windSpeedMax: number[];
  uvIndexMax: number[];
  sunrise: string[];
  sunset: string[];
}

export interface WeatherData {
  current: CurrentWeather;
  hourly: HourlyForecast;
  daily: DailyForecast;
}

// --- Pre-built weather cache (created by scripts/fetch-weather.mjs) ---
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let weatherCache: Record<string, WeatherData> = {};

/**
 * When the forecast data behind this build was actually fetched from
 * Open-Meteo. Every "last updated" signal on the site - the visible timestamp,
 * JSON-LD dateModified and sitemap lastmod - is derived from this single
 * value so they can never drift apart or claim a freshness the data lacks.
 */
export interface WeatherCacheMeta {
  /** ISO-8601 instant the forecast was fetched, or null when unknown. */
  fetchedAt: string | null;
  /** Number of locations in the cache. */
  locationCount: number;
  /** True when the cache was produced by scripts/make-fixture-cache.mjs. */
  synthetic: boolean;
}

export const weatherCacheMeta: WeatherCacheMeta = {
  fetchedAt: null,
  locationCount: 0,
  synthetic: false,
};

try {
  const cachePath = resolve(process.cwd(), 'src/data/weather-cache.json');
  const raw = readFileSync(cachePath, 'utf-8');
  const parsed = JSON.parse(raw);
  weatherCache = parsed.data || {};
  const count = Object.keys(weatherCache).length;
  weatherCacheMeta.locationCount = count;
  weatherCacheMeta.fetchedAt = parsed.fetchedAt ?? null;
  weatherCacheMeta.synthetic = parsed.synthetic === true;
  if (count > 0) {
    console.log(`[WEATHER] Cache loaded: ${count} locations (fetched: ${parsed.fetchedAt})`);
    if (weatherCacheMeta.synthetic) {
      console.warn('[WEATHER] WARNING: cache is SYNTHETIC fixture data - do not deploy this build');
    }
    const ageHours = (Date.now() - new Date(parsed.fetchedAt).getTime()) / 3_600_000;
    if (!(ageHours < 24)) {
      console.warn(
        `[WEATHER] WARNING: cache is ${Math.round(ageHours)}h old - the build is publishing outdated forecasts`,
      );
    }
  }
} catch {
  console.warn('[WEATHER] No pre-built cache found');
}

// Find nearest cached location as fallback (e.g., district → province center)
function findNearest(lat: number, lon: number): WeatherData | null {
  let best: WeatherData | null = null;
  let bestDist = Infinity;
  for (const [key, data] of Object.entries(weatherCache)) {
    const [clat, clon] = key.split('_').map(Number);
    const dist = Math.abs(clat - lat) + Math.abs(clon - lon);
    if (dist < bestDist) {
      bestDist = dist;
      best = data;
    }
  }
  return best;
}

export async function fetchWeatherData(lat: number, lon: number): Promise<WeatherData> {
  const cacheKey = `${lat.toFixed(2)}_${lon.toFixed(2)}`;

  // 1. Exact cache hit (handles 99%+ of cases)
  if (weatherCache[cacheKey]) {
    return weatherCache[cacheKey];
  }

  // 2. Nearest cached location (handles missing districts)
  const nearest = findNearest(lat, lon);
  if (nearest) {
    return nearest;
  }

  // No cache at all: the build must not silently fetch from the API here -
  // scripts/fetch-weather.mjs owns every Open-Meteo request.
  throw new Error(`No weather data available for ${cacheKey}. Run 'node scripts/fetch-weather.mjs' first.`);
}
