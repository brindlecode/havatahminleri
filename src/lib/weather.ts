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
}

export interface HourlyForecast {
  time: string[];
  temperature: number[];
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

try {
  const cachePath = resolve(process.cwd(), 'src/data/weather-cache.json');
  const raw = readFileSync(cachePath, 'utf-8');
  const parsed = JSON.parse(raw);
  weatherCache = parsed.data || {};
  const count = Object.keys(weatherCache).length;
  if (count > 0) {
    console.log(`[WEATHER] Cache loaded: ${count} locations (fetched: ${parsed.fetchedAt})`);
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

  // 3. Last resort: fetch from API at build time
  try {
    const params = new URLSearchParams({
      latitude: lat.toString(),
      longitude: lon.toString(),
      current: [
        'temperature_2m', 'relative_humidity_2m', 'apparent_temperature',
        'weather_code', 'wind_speed_10m', 'wind_direction_10m',
        'is_day', 'surface_pressure', 'cloud_cover', 'visibility',
      ].join(','),
      hourly: [
        'temperature_2m', 'weather_code', 'relative_humidity_2m',
        'precipitation_probability', 'wind_speed_10m', 'is_day',
        'dew_point_2m', 'visibility', 'surface_pressure', 'cloud_cover',
      ].join(','),
      daily: [
        'weather_code', 'temperature_2m_max', 'temperature_2m_min',
        'precipitation_sum', 'precipitation_probability_max',
        'wind_speed_10m_max', 'uv_index_max', 'sunrise', 'sunset',
      ].join(','),
      timezone: 'Europe/Istanbul',
      forecast_days: '16',
      forecast_hours: '48',
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();

    const result: WeatherData = {
      current: {
        temperature: data.current.temperature_2m,
        weatherCode: data.current.weather_code,
        windSpeed: data.current.wind_speed_10m,
        windDirection: data.current.wind_direction_10m,
        humidity: data.current.relative_humidity_2m,
        apparentTemperature: data.current.apparent_temperature,
        isDay: data.current.is_day === 1,
        pressure: data.current.surface_pressure ?? 1013,
        cloudCover: data.current.cloud_cover ?? 0,
        visibility: data.current.visibility ?? 10000,
      },
      hourly: {
        time: data.hourly.time,
        temperature: data.hourly.temperature_2m,
        weatherCode: data.hourly.weather_code,
        humidity: data.hourly.relative_humidity_2m,
        precipitationProbability: data.hourly.precipitation_probability,
        windSpeed: data.hourly.wind_speed_10m,
        isDay: data.hourly.is_day,
        dewPoint: data.hourly.dew_point_2m ?? [],
        visibility: data.hourly.visibility ?? [],
        pressure: data.hourly.surface_pressure ?? [],
        cloudCover: data.hourly.cloud_cover ?? [],
      },
      daily: {
        time: data.daily.time,
        weatherCode: data.daily.weather_code,
        temperatureMax: data.daily.temperature_2m_max,
        temperatureMin: data.daily.temperature_2m_min,
        precipitationSum: data.daily.precipitation_sum,
        precipitationProbabilityMax: data.daily.precipitation_probability_max,
        windSpeedMax: data.daily.wind_speed_10m_max,
        uvIndexMax: data.daily.uv_index_max,
        sunrise: data.daily.sunrise,
        sunset: data.daily.sunset,
      },
    };

    weatherCache[cacheKey] = result;
    return result;
  } catch (err) {
    console.error(`[WEATHER] Failed to fetch lat=${lat}, lon=${lon}:`, err);
    throw new Error(`No weather data available for ${cacheKey}. Run 'node scripts/fetch-weather.mjs' first.`);
  }
}
