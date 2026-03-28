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

function generatePlaceholderData(lat: number): WeatherData {
  const now = new Date();
  const baseTempByLat = 35 - (Math.abs(lat - 36) * 1.5);
  const baseTemp = Math.round(baseTempByLat + (Math.random() * 6 - 3));

  const hourlyTimes: string[] = [];
  const hourlyTemps: number[] = [];
  const hourlyCodes: number[] = [];
  const hourlyHumidity: number[] = [];
  const hourlyPrecip: number[] = [];
  const hourlyWind: number[] = [];
  const hourlyIsDay: number[] = [];

  for (let i = 0; i < 48; i++) {
    const d = new Date(now.getTime() + i * 3600000);
    hourlyTimes.push(d.toISOString().slice(0, 16));
    const h = d.getHours();
    const dayNight = h >= 6 && h <= 20 ? 1 : 0;
    const variation = Math.sin((h - 6) * Math.PI / 12) * 5;
    hourlyTemps.push(Math.round((baseTemp + variation) * 10) / 10);
    hourlyCodes.push(h % 7 === 0 ? 2 : 0);
    hourlyHumidity.push(50 + Math.round(Math.random() * 20));
    hourlyPrecip.push(0);
    hourlyWind.push(5 + Math.round(Math.random() * 10));
    hourlyIsDay.push(dayNight);
  }

  const dailyTimes: string[] = [];
  const dailyCodes: number[] = [];
  const dailyMax: number[] = [];
  const dailyMin: number[] = [];
  const dailyPrecip: number[] = [];
  const dailyPrecipProb: number[] = [];
  const dailyWind: number[] = [];
  const dailyUV: number[] = [];
  const dailySunrise: string[] = [];
  const dailySunset: string[] = [];

  for (let i = 0; i < 16; i++) {
    const d = new Date(now.getTime() + i * 86400000);
    dailyTimes.push(d.toISOString().slice(0, 10));
    dailyCodes.push(i % 5 === 0 ? 2 : i % 7 === 0 ? 61 : 0);
    dailyMax.push(baseTemp + 3 + Math.round(Math.random() * 4));
    dailyMin.push(baseTemp - 3 - Math.round(Math.random() * 4));
    dailyPrecip.push(i % 7 === 0 ? 2.5 : 0);
    dailyPrecipProb.push(i % 7 === 0 ? 40 : i % 5 === 0 ? 20 : 0);
    dailyWind.push(8 + Math.round(Math.random() * 15));
    dailyUV.push(3 + Math.round(Math.random() * 5));
    dailySunrise.push(`${d.toISOString().slice(0, 10)}T06:30`);
    dailySunset.push(`${d.toISOString().slice(0, 10)}T19:30`);
  }

  return {
    current: {
      temperature: baseTemp,
      weatherCode: 0,
      windSpeed: 8,
      windDirection: 180,
      humidity: 55,
      apparentTemperature: baseTemp - 1,
      isDay: true,
      pressure: 1013,
      cloudCover: 25,
      visibility: 10000,
    },
    hourly: {
      time: hourlyTimes,
      temperature: hourlyTemps,
      weatherCode: hourlyCodes,
      humidity: hourlyHumidity,
      precipitationProbability: hourlyPrecip,
      windSpeed: hourlyWind,
      isDay: hourlyIsDay,
      dewPoint: hourlyTemps.map(t => t - 5),
      visibility: hourlyTemps.map(() => 10000),
      pressure: hourlyTemps.map(() => 1013),
      cloudCover: hourlyTemps.map((_, i) => i % 3 === 0 ? 30 : 10),
    },
    daily: {
      time: dailyTimes,
      weatherCode: dailyCodes,
      temperatureMax: dailyMax,
      temperatureMin: dailyMin,
      precipitationSum: dailyPrecip,
      precipitationProbabilityMax: dailyPrecipProb,
      windSpeedMax: dailyWind,
      uvIndexMax: dailyUV,
      sunrise: dailySunrise,
      sunset: dailySunset,
    },
  };
}

export async function fetchWeatherData(lat: number, lon: number): Promise<WeatherData> {
  // Skip API calls if environment variable is set (for offline builds)
  if (typeof process !== 'undefined' && process.env?.OFFLINE_BUILD === 'true') {
    return generatePlaceholderData(lat);
  }

  try {
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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${BASE_URL}?${params}`, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      return generatePlaceholderData(lat);
    }

    const data = await res.json();

    return {
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
  } catch {
    return generatePlaceholderData(lat);
  }
}

export function getClientFetchScript(lat: number, lon: number): string {
  return `
    (function() {
      const CACHE_KEY = 'weather_${lat}_${lon}';
      const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

      function getCached() {
        try {
          const cached = localStorage.getItem(CACHE_KEY);
          if (!cached) return null;
          const { data, timestamp } = JSON.parse(cached);
          if (Date.now() - timestamp > CACHE_DURATION) return null;
          return data;
        } catch { return null; }
      }

      function setCache(data) {
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }));
        } catch {}
      }

      async function refresh() {
        const cached = getCached();
        if (cached) { updateUI(cached); return; }

        try {
          const params = new URLSearchParams({
            latitude: '${lat}',
            longitude: '${lon}',
            current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,is_day',
            hourly: 'temperature_2m,weather_code,relative_humidity_2m,precipitation_probability,wind_speed_10m,is_day',
            daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,uv_index_max,sunrise,sunset',
            timezone: 'Europe/Istanbul',
            forecast_days: '16',
            forecast_hours: '48'
          });
          const res = await fetch('https://api.open-meteo.com/v1/forecast?' + params);
          const data = await res.json();
          setCache(data);
          updateUI(data);
        } catch (e) {
          console.error('Weather refresh failed:', e);
        }
      }

      function updateUI(data) {
        const event = new CustomEvent('weatherUpdate', { detail: data });
        document.dispatchEvent(event);
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', refresh);
      } else {
        refresh();
      }
    })();
  `;
}
