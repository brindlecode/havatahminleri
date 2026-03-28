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

const BASE_URL = 'https://api.open-meteo.com/v1/forecast';

// Simple delay helper
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Rate limiter - ensure we don't exceed 600 calls/minute
let lastCallTime = 0;
const MIN_INTERVAL = 120; // 120ms between calls = ~500 calls/min (under 600 limit)

async function rateLimitedFetch(url: string): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastCallTime;
  if (elapsed < MIN_INTERVAL) {
    await delay(MIN_INTERVAL - elapsed);
  }
  lastCallTime = Date.now();

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (res.ok) return res;

      if (res.status === 429 && attempt < 3) {
        console.warn(`[WEATHER] Rate limited, waiting ${attempt * 3}s...`);
        await delay(3000 * attempt);
        continue;
      }

      throw new Error(`API error: ${res.status}`);
    } catch (err: any) {
      if (attempt === 3) throw err;
      await delay(1000 * attempt);
    }
  }
  throw new Error('All retries exhausted');
}

// In-memory cache to avoid fetching same location multiple times during build
const buildCache = new Map<string, WeatherData>();

// Minimal placeholder for OFFLINE local dev builds only - never shown on production
function devPlaceholder(lat: number): WeatherData {
  const now = new Date();
  const times48 = Array.from({length: 48}, (_, i) => new Date(now.getTime() + i * 3600000).toISOString().slice(0, 16));
  const times16 = Array.from({length: 16}, (_, i) => { const d = new Date(now.getTime() + i * 86400000); return d.toISOString().slice(0, 10); });
  const t = 15; // generic spring temp
  return {
    current: { temperature: t, weatherCode: 2, windSpeed: 10, windDirection: 180, humidity: 60, apparentTemperature: t-2, isDay: true, pressure: 1013, cloudCover: 40, visibility: 10000 },
    hourly: { time: times48, temperature: times48.map(() => t), weatherCode: times48.map(() => 2), humidity: times48.map(() => 60), precipitationProbability: times48.map(() => 10), windSpeed: times48.map(() => 10), isDay: times48.map((_, i) => (i % 24) >= 6 && (i % 24) <= 20 ? 1 : 0), dewPoint: times48.map(() => 8), visibility: times48.map(() => 10000), pressure: times48.map(() => 1013), cloudCover: times48.map(() => 40) },
    daily: { time: times16, weatherCode: times16.map(() => 2), temperatureMax: times16.map(() => t+5), temperatureMin: times16.map(() => t-3), precipitationSum: times16.map(() => 0), precipitationProbabilityMax: times16.map(() => 10), windSpeedMax: times16.map(() => 15), uvIndexMax: times16.map(() => 4), sunrise: times16.map(d => d+'T06:30'), sunset: times16.map(d => d+'T19:00') },
  };
}

export async function fetchWeatherData(lat: number, lon: number): Promise<WeatherData> {
  // OFFLINE_BUILD: only for local development, NEVER set on Netlify
  if (typeof process !== 'undefined' && process.env?.OFFLINE_BUILD === 'true') {
    return devPlaceholder(lat);
  }

  // Check build-time cache (same location = same data for all period pages)
  const cacheKey = `${lat.toFixed(2)}_${lon.toFixed(2)}`;
  const cached = buildCache.get(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    current: [
      'temperature_2m',
      'relative_humidity_2m',
      'apparent_temperature',
      'weather_code',
      'wind_speed_10m',
      'wind_direction_10m',
      'is_day',
      'surface_pressure',
      'cloud_cover',
      'visibility',
    ].join(','),
    hourly: [
      'temperature_2m',
      'weather_code',
      'relative_humidity_2m',
      'precipitation_probability',
      'wind_speed_10m',
      'is_day',
      'dew_point_2m',
      'visibility',
      'surface_pressure',
      'cloud_cover',
    ].join(','),
    daily: [
      'weather_code',
      'temperature_2m_max',
      'temperature_2m_min',
      'precipitation_sum',
      'precipitation_probability_max',
      'wind_speed_10m_max',
      'uv_index_max',
      'sunrise',
      'sunset',
    ].join(','),
    timezone: 'Europe/Istanbul',
    forecast_days: '16',
    forecast_hours: '48',
  });

  const url = `${BASE_URL}?${params}`;

  try {
    const res = await rateLimitedFetch(url);
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

    // Cache for reuse by other period pages of same location
    buildCache.set(cacheKey, result);
    return result;
  } catch (err) {
    console.error(`[WEATHER API ERROR] lat=${lat}, lon=${lon}:`, err);
    throw err;
  }
}
