import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Air quality, sea temperature and weather warnings, read from
 * src/data/extras-cache.json (written by scripts/fetch-extras.mjs). Every
 * accessor returns null / [] when the data is missing, and the components
 * then render nothing: the forecast pages never depend on these feeds.
 */

export interface AirSeries {
  time: string[];
  aqi: (number | null)[];
  pm25: (number | null)[];
  pm10: (number | null)[];
}

export interface SeaSeries {
  time: string[];
  sst: (number | null)[];
  waveMax: (number | null)[];
}

export interface Warning {
  id: string;
  /** 2 yellow, 3 orange, 4 red. */
  level: number;
  type: string;
  event: string;
  headline: string;
  description: string;
  instruction: string;
  onset: string | null;
  expires: string | null;
  areas: string[];
  plates: number[];
}

interface ExtrasCache {
  fetchedAt?: string;
  day?: string;
  synthetic?: boolean;
  air?: Record<string, AirSeries>;
  sea?: Record<string, SeaSeries>;
  warnings?: { source?: string; ok?: boolean; items?: Warning[] };
}

let cache: ExtrasCache | null = null;
function load(): ExtrasCache {
  if (cache) return cache;
  const path = resolve(process.cwd(), 'src/data/extras-cache.json');
  try {
    cache = existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')) : {};
  } catch {
    cache = {};
  }
  return cache!;
}

export const extrasDay = () => load().day ?? null;
export const extrasFetchedAt = () => load().fetchedAt ?? null;
export const getAir = (plate: number): AirSeries | null => load().air?.[plate] ?? null;
export const getSea = (plate: number): SeaSeries | null => load().sea?.[plate] ?? null;
export const allAir = () => load().air ?? {};
export const allSea = () => load().sea ?? {};

/** Active warnings at build time, most severe first. */
export function getWarnings(now = Date.now()): Warning[] {
  return (load().warnings?.items ?? []).filter((w) => !w.expires || new Date(w.expires).getTime() > now);
}
export const warningsFor = (plate: number) => getWarnings().filter((w) => w.plates.includes(plate));

// --- Air quality -------------------------------------------------------------

export interface AqiBand {
  key: 'good' | 'fair' | 'moderate' | 'poor' | 'vpoor' | 'xpoor';
  label: string;
  color: string;
  advice: string;
}

/** European Air Quality Index bands (EEA), with Turkish wording. */
export const AQI_BANDS: (AqiBand & { max: number })[] = [
  { max: 20, key: 'good', label: 'İyi', color: '#3fcfc0', advice: 'Açık havada her türlü etkinlik için uygun.' },
  { max: 40, key: 'fair', label: 'Makul', color: '#4cb38f', advice: 'Açık hava etkinlikleri için uygun.' },
  { max: 60, key: 'moderate', label: 'Orta', color: '#d9c22e', advice: 'Hassas kişiler uzun ve yorucu açık hava etkinliklerini azaltabilir.' },
  { max: 80, key: 'poor', label: 'Kötü', color: '#ef5a4c', advice: 'Astım, kalp ve akciğer hastaları dışarıda yorucu etkinlikten kaçınmalı.' },
  { max: 100, key: 'vpoor', label: 'Çok kötü', color: '#a3123d', advice: 'Herkes dışarıdaki yorucu etkinlikleri azaltmalı; hassas kişiler içeride kalmalı.' },
  { max: Infinity, key: 'xpoor', label: 'Son derece kötü', color: '#6e1f7a', advice: 'Dışarıda geçirilen süreyi en aza indirin.' },
];

export function aqiBand(aqi: number): AqiBand {
  return AQI_BANDS.find((b) => aqi <= b.max)!;
}

export interface AirDay {
  /** Typical value over waking hours (median of 08-22). */
  typical: number;
  /** Worst hour of the day and its value. */
  worst: number;
  worstHour: number;
  pm25: number | null;
  pm10: number | null;
  band: AqiBand;
  worstBand: AqiBand;
  hours: { h: number; aqi: number }[];
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

/** Summary of day 0 (today) or 1 (tomorrow) of a 48-hour series. */
export function airDay(s: AirSeries | null, day: 0 | 1): AirDay | null {
  if (!s) return null;
  const hours: { h: number; aqi: number; pm25: number | null; pm10: number | null }[] = [];
  for (let h = 0; h < 24; h++) {
    const v = s.aqi[day * 24 + h];
    if (typeof v === 'number') hours.push({ h, aqi: Math.round(v), pm25: s.pm25[day * 24 + h], pm10: s.pm10[day * 24 + h] });
  }
  if (hours.length < 12) return null;
  const waking = hours.filter((x) => x.h >= 8 && x.h <= 22);
  const typical = Math.round(median((waking.length ? waking : hours).map((x) => x.aqi)));
  const worstAt = hours.reduce((a, b) => (b.aqi > a.aqi ? b : a));
  const avg = (k: 'pm25' | 'pm10') => {
    const v = hours.map((x) => x[k]).filter((x): x is number => typeof x === 'number');
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  return {
    typical,
    worst: worstAt.aqi,
    worstHour: worstAt.h,
    pm25: avg('pm25'),
    pm10: avg('pm10'),
    band: aqiBand(typical),
    worstBand: aqiBand(worstAt.aqi),
    hours: hours.map(({ h, aqi }) => ({ h, aqi })),
  };
}

// --- Sea ---------------------------------------------------------------------

export function seaFeel(t: number): string {
  if (t < 16) return 'çok soğuk';
  if (t < 19) return 'soğuk';
  if (t < 22) return 'serin';
  if (t < 25) return 'yüzmek için ideal';
  if (t < 28) return 'ılık';
  return 'çok ılık';
}

export function waveFeel(m: number): string {
  if (m < 0.5) return 'sakin';
  if (m < 1.25) return 'hafif dalgalı';
  if (m < 2.5) return 'dalgalı';
  return 'çok dalgalı';
}

export interface SeaDay {
  /** Daytime (12:00) water temperature. */
  temp: number;
  min: number;
  max: number;
  wave: number | null;
  feel: string;
}

export function seaDay(s: SeaSeries | null, day: 0 | 1): SeaDay | null {
  if (!s) return null;
  const v = s.sst.slice(day * 24, day * 24 + 24).filter((x): x is number => typeof x === 'number');
  if (v.length < 6) return null;
  const noon = s.sst[day * 24 + 12];
  const temp = Math.round(typeof noon === 'number' ? noon : v[Math.floor(v.length / 2)]);
  const wave = s.waveMax[day];
  return {
    temp,
    min: Math.round(Math.min(...v)),
    max: Math.round(Math.max(...v)),
    wave: typeof wave === 'number' ? wave : null,
    feel: seaFeel(temp),
  };
}

// --- Warnings ----------------------------------------------------------------

export const LEVEL_LABEL: Record<number, string> = { 2: 'Sarı', 3: 'Turuncu', 4: 'Kırmızı' };

const TYPE_LABEL: Record<string, string> = {
  wind: 'Kuvvetli rüzgar',
  'snow-ice': 'Kar ve buzlanma',
  thunderstorm: 'Gök gürültülü sağanak',
  fog: 'Sis',
  'high-temperature': 'Aşırı sıcak',
  'low-temperature': 'Aşırı soğuk',
  'coastalevent': 'Kıyı olayı',
  'coastal-event': 'Kıyı olayı',
  'forest-fire': 'Orman yangını riski',
  avalanches: 'Çığ',
  rain: 'Kuvvetli yağış',
  flooding: 'Sel',
  'rain-flood': 'Sel ve taşkın',
};

/** Turkish title for a warning: the feed's own Turkish event name when it has one. */
export function warningTitle(w: Warning): string {
  if (w.event && /[çğıöşüÇĞİÖŞÜ]|uyar/i.test(w.event)) return w.event;
  return TYPE_LABEL[w.type] ?? (w.event || 'Meteorolojik uyarı');
}

const TR_TIME = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul',
  weekday: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

/** "Perşembe 14:00 - Cuma 06:00" */
export function warningWindow(w: Warning): string {
  const f = (iso: string | null) => (iso ? TR_TIME.format(new Date(iso)).replace(/^(\p{L})/u, (c) => c.toLocaleUpperCase('tr')) : '');
  const a = f(w.onset);
  const b = f(w.expires);
  return a && b ? `${a} – ${b}` : a || b;
}
