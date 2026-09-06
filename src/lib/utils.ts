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

export function formatDate(dateStr: string, options?: Intl.DateTimeFormatOptions): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('tr-TR', options ?? {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

export function formatShortDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('tr-TR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function formatHour(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getDayName(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);

  if (date.toDateString() === today.toDateString()) return 'Bugün';
  if (date.toDateString() === tomorrow.toDateString()) return 'Yarın';

  return date.toLocaleDateString('tr-TR', { weekday: 'long' });
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
