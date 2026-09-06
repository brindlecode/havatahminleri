import type { WeatherData, DailyForecast } from './weather.ts';

/**
 * Every forecast period the site publishes, plus the pseudo-period `base`
 * used by the location landing pages (/kocaeli-hava-durumu/ and
 * /kocaeli/izmit-hava-durumu/).
 *
 * This module is the single source of truth for:
 *   - how many forecast days a period shows,
 *   - which hourly range it shows,
 *   - what its canonical URL is,
 *   - what its heading/label is.
 *
 * Period-specific logic used to be duplicated across ForecastLayout, both
 * [period].astro routes and both landing pages, which is how the "15 Günlük"
 * page ended up rendering 16 days.
 */
export type PeriodId = 'base' | 'bugun' | 'yarin' | '7gun' | '10gun' | '15gun' | 'saatlik';

export interface ForecastPeriod {
  id: PeriodId;
  /** URL segment; `base` has none - it IS the location URL. */
  slug: string | null;
  /** Short label used in the period navigation. */
  label: string;
  /** First daily index shown (0 = today). */
  dayStart: number;
  /** Number of daily rows shown. 0 = no daily table. */
  dayCount: number;
  /** Hourly slice [start, end) over the 48-hour series. null = no hourly. */
  hourly: [number, number] | null;
  /** Heading for the daily table. */
  dailyTitle: string;
  /** Heading for the hourly strip. */
  hourlyTitle: string | null;
}

export const PERIOD_DEFS: Record<PeriodId, ForecastPeriod> = {
  base: {
    id: 'base',
    slug: null,
    label: 'Yarın',
    dayStart: 1,
    dayCount: 1,
    hourly: [24, 48],
    dailyTitle: 'Yarınki Hava Durumu',
    hourlyTitle: 'Yarın Saatlik Tahmin',
  },
  bugun: {
    id: 'bugun',
    slug: 'bugun',
    label: 'Bugün',
    dayStart: 0,
    dayCount: 1,
    hourly: [0, 24],
    dailyTitle: 'Bugünkü Hava Durumu',
    hourlyTitle: 'Bugün Saat Saat',
  },
  yarin: {
    id: 'yarin',
    slug: 'yarin',
    label: 'Yarın',
    dayStart: 1,
    dayCount: 1,
    hourly: [24, 48],
    dailyTitle: 'Yarınki Hava Durumu',
    hourlyTitle: 'Yarın Saat Saat',
  },
  '7gun': {
    id: '7gun',
    slug: '7-gunluk',
    label: '7 Günlük',
    dayStart: 0,
    dayCount: 7,
    hourly: null,
    dailyTitle: '7 Günlük Hava Tahmini',
    hourlyTitle: null,
  },
  '10gun': {
    id: '10gun',
    slug: '10-gunluk',
    label: '10 Günlük',
    dayStart: 0,
    dayCount: 10,
    hourly: null,
    dailyTitle: '10 Günlük Hava Tahmini',
    hourlyTitle: null,
  },
  '15gun': {
    id: '15gun',
    slug: '15-gunluk',
    // 15 days means 15 rows. The API returns 16 (forecast_days=16) so that
    // day 15 still has a neighbour for trend maths, but the page must never
    // show a 16th row under a "15 Günlük" heading.
    label: '15 Günlük',
    dayStart: 0,
    dayCount: 15,
    hourly: null,
    dailyTitle: '15 Günlük Hava Tahmini',
    hourlyTitle: null,
  },
  saatlik: {
    id: 'saatlik',
    slug: 'saatlik',
    label: 'Saatlik',
    dayStart: 0,
    dayCount: 0,
    hourly: [0, 48],
    dailyTitle: '',
    hourlyTitle: '48 Saatlik Tahmin',
  },
};

/** Periods that get their own URL, in navigation order. */
export const PERIODS: ForecastPeriod[] = [
  PERIOD_DEFS.bugun,
  PERIOD_DEFS.yarin,
  PERIOD_DEFS['7gun'],
  PERIOD_DEFS['10gun'],
  PERIOD_DEFS['15gun'],
  PERIOD_DEFS.saatlik,
];

export const SITE_ORIGIN = 'https://yarinhava.com';

/** Path (always with trailing slash) of a location's landing page. */
export function getLocationPath(provinceSlug: string, districtSlug?: string | null): string {
  return districtSlug
    ? `/${provinceSlug}/${districtSlug}-hava-durumu/`
    : `/${provinceSlug}-hava-durumu/`;
}

/** Absolute canonical URL for a location + period. */
export function getCanonicalForPeriod(
  provinceSlug: string,
  periodId: PeriodId,
  districtSlug?: string | null,
): string {
  const base = getLocationPath(provinceSlug, districtSlug);
  const slug = PERIOD_DEFS[periodId].slug;
  return slug ? `${SITE_ORIGIN}${base}${slug}/` : `${SITE_ORIGIN}${base}`;
}

/**
 * Period navigation links for a location.
 *
 * `basePath` must be the location path WITHOUT a trailing slash, e.g.
 * "/kocaeli-hava-durumu".
 */
export function getPeriodLinks(basePath: string): { label: string; href: string; id: PeriodId }[] {
  return PERIODS.map((p) => ({
    id: p.id,
    label: p.label,
    href: `${basePath}/${p.slug}/`,
  }));
}

function sliceDaily(daily: DailyForecast, start: number, count: number): DailyForecast {
  const end = start + count;
  return {
    time: daily.time.slice(start, end),
    weatherCode: daily.weatherCode.slice(start, end),
    temperatureMax: daily.temperatureMax.slice(start, end),
    temperatureMin: daily.temperatureMin.slice(start, end),
    precipitationSum: daily.precipitationSum.slice(start, end),
    precipitationProbabilityMax: daily.precipitationProbabilityMax.slice(start, end),
    windSpeedMax: daily.windSpeedMax.slice(start, end),
    uvIndexMax: daily.uvIndexMax.slice(start, end),
    sunrise: daily.sunrise.slice(start, end),
    sunset: daily.sunset.slice(start, end),
  };
}

export interface PeriodForecastData {
  period: ForecastPeriod;
  /** Daily rows for this period; empty for /saatlik/. */
  daily: DailyForecast;
  /** Whether the hourly strip should render. */
  showHourly: boolean;
  hourlyStart: number;
  hourlyEnd: number;
}

/**
 * Slice a location's full forecast down to exactly what a period page shows.
 * The day count is capped by the data actually available so a short API
 * response can never produce a table with missing cells.
 */
export function getPeriodForecastData(
  weather: WeatherData,
  periodId: PeriodId,
): PeriodForecastData {
  const period = PERIOD_DEFS[periodId];
  const available = Math.max(0, weather.daily.time.length - period.dayStart);
  const count = Math.min(period.dayCount, available);

  const [hourlyStart, hourlyEnd] = period.hourly ?? [0, 0];
  const hoursAvailable = weather.hourly.time.length;

  return {
    period,
    daily: sliceDaily(weather.daily, period.dayStart, count),
    showHourly: period.hourly !== null && hoursAvailable > hourlyStart,
    hourlyStart,
    hourlyEnd: Math.min(hourlyEnd, hoursAvailable),
  };
}
