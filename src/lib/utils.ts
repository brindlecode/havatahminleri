export function getTempColorClass(temp: number): string {
  if (temp >= 35) return 'temp-hot';
  if (temp >= 25) return 'temp-warm';
  if (temp >= 15) return 'temp-mild';
  if (temp >= 5) return 'temp-cool';
  if (temp >= -5) return 'temp-cold';
  return 'temp-freezing';
}

export function getTempBgGradient(temp: number): string {
  if (temp >= 35) return 'from-red-500 to-orange-400';
  if (temp >= 25) return 'from-orange-400 to-amber-300';
  if (temp >= 15) return 'from-amber-300 to-yellow-200';
  if (temp >= 5) return 'from-blue-300 to-cyan-200';
  if (temp >= -5) return 'from-blue-500 to-blue-300';
  return 'from-indigo-600 to-blue-500';
}

/**
 * Forecast timestamps from Open-Meteo are already local Turkey time without an
 * offset ("2026-09-26" / "2026-09-26T14:00"). They are parsed and formatted as
 * UTC so the output never depends on the timezone of the machine running the
 * build; "today" is always computed in Europe/Istanbul.
 */
export const TIMEZONE = 'Europe/Istanbul';

function asUtcDate(dateStr: string): Date {
  const day = dateStr.slice(0, 10);
  const time = dateStr.length > 10 ? dateStr.slice(11, 16) : '00:00';
  return new Date(`${day}T${time}:00Z`);
}

/** Today's date (YYYY-MM-DD) in Turkey, optionally shifted by whole days. */
export function istanbulDate(offsetDays = 0, now: Date = new Date()): string {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  if (!offsetDays) return today;
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export function formatDate(dateStr: string, options?: Intl.DateTimeFormatOptions): string {
  return asUtcDate(dateStr).toLocaleDateString('tr-TR', {
    ...(options ?? { weekday: 'long', day: 'numeric', month: 'long' }),
    timeZone: 'UTC',
  });
}

export function formatShortDate(dateStr: string): string {
  return asUtcDate(dateStr).toLocaleDateString('tr-TR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

export function formatHour(dateStr: string): string {
  // "2026-09-26T14:00" -> "14:00"; the value is already Turkey local time.
  return dateStr.length >= 16 ? dateStr.slice(11, 16) : '';
}

/**
 * "Bugün" / "Yarın" / weekday name, relative to today in Turkey. These labels
 * are baked into static HTML; public/scripts/weather-now.js re-labels them in
 * the browser if the page is viewed on a later day than it was built.
 */
export function getDayName(dateStr: string, now: Date = new Date()): string {
  const day = dateStr.slice(0, 10);
  if (day === istanbulDate(0, now)) return 'Bugün';
  if (day === istanbulDate(1, now)) return 'Yarın';
  return asUtcDate(day).toLocaleDateString('tr-TR', { weekday: 'long', timeZone: 'UTC' });
}

export function getWindDirection(degrees: number): string {
  const directions = ['K', 'KD', 'D', 'GD', 'G', 'GB', 'B', 'KB'];
  const index = Math.round(degrees / 45) % 8;
  return directions[index];
}

export function getUVLevel(uv: number): { label: string; color: string } {
  if (uv <= 2) return { label: 'Düşük', color: 'text-green-500' };
  if (uv <= 5) return { label: 'Orta', color: 'text-yellow-500' };
  if (uv <= 7) return { label: 'Yüksek', color: 'text-orange-500' };
  if (uv <= 10) return { label: 'Çok Yüksek', color: 'text-red-500' };
  return { label: 'Aşırı', color: 'text-purple-500' };
}

/**
 * Turkish locative suffix with vowel harmony: 'da, 'de, 'ta, 'te
 * Example: Adana'da, İzmir'de, Sivas'ta, Kars'ta
 */
export function getLocativeSuffix(name: string): string {
  const lower = name.toLowerCase().replace(/\s+/g, '');
  const backVowels = ['a', 'ı', 'o', 'u'];
  const frontVowels = ['e', 'i', 'ö', 'ü'];
  const voiceless = ['p', 'ç', 't', 'k', 'f', 'h', 's', 'ş'];

  // Find last vowel for a/e harmony
  let lastVowelIsBack = true;
  for (let i = lower.length - 1; i >= 0; i--) {
    if (backVowels.includes(lower[i])) { lastVowelIsBack = true; break; }
    if (frontVowels.includes(lower[i])) { lastVowelIsBack = false; break; }
  }

  const lastChar = lower[lower.length - 1];
  const consonant = voiceless.includes(lastChar) ? 't' : 'd';
  const vowel = lastVowelIsBack ? 'a' : 'e';

  return `${name}'${consonant}${vowel}`;
}

/**
 * Returns city name with locative suffix for use in sentences
 * Example: "Adana'da", "İzmir'de"
 */
export function getCityLocative(cityName: string): string {
  // Disambiguated names like "Ortaköy (Çorum)": the suffix attaches to the
  // place itself, "Ortaköy'de (Çorum)", not to the parenthesis.
  const paren = cityName.match(/^(.*\S)\s+(\([^)]*\))$/);
  if (paren) {
    return `${getCityLocative(paren[1])} ${paren[2]}`;
  }
  // For compound names like "Seyhan, Adana", use first part
  const parts = cityName.split(',');
  if (parts.length > 1) {
    return getLocativeSuffix(parts[0].trim()) + ',' + parts.slice(1).join(',');
  }
  return getLocativeSuffix(cityName);
}

// slugify lives in ./slug so the Turkish İ/I/ı handling has one home and one
// test suite. Re-exported here for the existing import sites.
export { slugify, foldTurkish, isLegacyDottedISlug } from './slug.ts';
