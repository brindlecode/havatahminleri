import { weatherCacheMeta } from './weather.ts';

const TIMEZONE = 'Europe/Istanbul';

export interface ForecastFreshness {
  /** ISO-8601 instant the forecast data was fetched. */
  iso: string;
  /** YYYY-MM-DD in Europe/Istanbul - used for JSON-LD dateModified. */
  date: string;
  /** Human-readable Turkish label, e.g. "6 Eylül 2026 20:15". */
  label: string;
  /** Hours between the fetch and now. */
  ageHours: number;
  /** True when the data is older than the 12-hourly build cadence allows. */
  stale: boolean;
}

const DATE_LABEL = new Intl.DateTimeFormat('tr-TR', {
  timeZone: TIMEZONE,
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const DATE_ONLY = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Freshness of the forecast data this build was generated from.
 *
 * The value comes from weather-cache.json's `fetchedAt`, written by
 * scripts/fetch-weather.mjs at fetch time. It is deliberately NOT
 * `new Date()`: a build that reuses a cache must report the age of the data,
 * not the age of the build, or the site would again claim freshness it does
 * not have - which is exactly what happened between July and August 2026.
 *
 * Returns null when no cache is present, so callers can omit the signal
 * rather than invent one.
 */
export function getForecastFreshness(): ForecastFreshness | null {
  const iso = weatherCacheMeta.fetchedAt;
  if (!iso) return null;

  const fetched = new Date(iso);
  if (Number.isNaN(fetched.getTime())) return null;

  const ageHours = (Date.now() - fetched.getTime()) / 3_600_000;

  return {
    iso: fetched.toISOString(),
    date: DATE_ONLY.format(fetched),
    // tr-TR renders "6 Eylül 2026 20:15"; normalise the stray comma some
    // ICU builds insert between the date and the time.
    label: DATE_LABEL.format(fetched).replace(/,\s*/, ' '),
    ageHours,
    stale: ageHours >= 24,
  };
}
