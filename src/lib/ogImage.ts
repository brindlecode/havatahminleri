import type { WeatherData } from './weather.ts';
import { getWeatherDescription } from './weatherCodes.ts';
import { getIconSVG } from './weatherIconSvg.ts';
import { getActivityAdvice, type Verdict } from './activityAdvice.ts';
import { weekdayName, dayMonth } from './periodSummary.ts';
import { SITE_ORIGIN, weekendRange, type PeriodId } from './periods.ts';

/**
 * Per-location share images (Open Graph / WhatsApp link previews).
 *
 * One 1200x630 PNG per location and day: the place name, the date, the
 * forecast and the chore verdicts from activityAdvice.ts, on the same sky
 * colour the page hero uses. The date is part of the file name, so a preview
 * cached by WhatsApp/Facebook can never present an old forecast as current:
 * the image itself says which day it describes, and each day's pages point
 * at a new file. Rendered at build time by src/pages/og/[...path].png.ts.
 */

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/**
 * Pages about today show today's image; every other page shows tomorrow's.
 * The weekend page shows its first day when that is today or tomorrow, and
 * no day image (null: the site-wide default) when the weekend is further out,
 * since images exist for today and tomorrow only.
 */
export function ogDayIndex(period: PeriodId, firstDay?: string): 0 | 1 | null {
  if (period === 'haftasonu') {
    const start = firstDay ? weekendRange(firstDay).start : 2;
    return start === 0 || start === 1 ? start : null;
  }
  return period === 'bugun' || period === 'saatlik' ? 0 : 1;
}

/** "kocaeli-2026-10-05" or "kocaeli/izmit-2026-10-05" (no extension). */
export function ogImageSlug(provinceSlug: string, districtSlug: string | null, date: string): string {
  return districtSlug ? `${provinceSlug}/${districtSlug}-${date}` : `${provinceSlug}-${date}`;
}

export function ogImageUrl(provinceSlug: string, districtSlug: string | null, date: string): string {
  return `${SITE_ORIGIN}/og/${ogImageSlug(provinceSlug, districtSlug, date)}.png`;
}

export interface OgImageInput {
  weather: WeatherData;
  dayIndex: 0 | 1;
  /** Big title: "İzmit", "Kocaeli", "Adıyaman Merkez". */
  title: string;
  /** Province shown under a district's name; null for province pages. */
  provinceName: string | null;
  /** names.display, for the advice sentences ("Ortaköy (Çorum)"). */
  displayName: string;
}

// Day variants of the .sky-* hero gradients in src/styles/global.css. The
// gradient is vertical so the PNG compresses to a few dozen KB.
function skyStops(code: number): [string, string, string] {
  if (code === 0 || code === 1) return ['#2b7fe0', '#4f9ff0', '#8cc6f7'];
  if (code === 2) return ['#3a7fc8', '#6f9fd0', '#a9c3df'];
  if (code === 3) return ['#5f7188', '#7f90a5', '#a7b4c4'];
  if (code === 45 || code === 48) return ['#6b7686', '#87919f', '#a9b1bc'];
  if (code >= 95) return ['#1f2233', '#353a52', '#4d5372'];
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return ['#5d7793', '#7d93ab', '#a3b5c8'];
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return ['#36506f', '#4f6a8b', '#7890ab'];
  return ['#3a7fc8', '#6f9fd0', '#a9c3df'];
}

const VERDICT_COLOR: Record<Verdict, string> = { good: '#4ade80', fair: '#fbbf24', poor: '#f87171' };
const VERDICT_TEXT: Record<Verdict, string> = { good: 'Uygun', fair: 'Dikkat', poor: 'Ertele' };
// Infinitives: "Cam silme" above "Uygun" can read as "don't wipe".
const ACTIVITY_LABEL: Record<string, string> = {
  arac: 'Araç yıkamak',
  cam: 'Cam silmek',
  camasir: 'Çamaşır kurutmak',
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Font size that keeps `text` within `maxWidth`. Figtree ExtraBold averages
 * ~0.56em per character for Turkish place names; this errs on the safe side.
 */
function fitFontSize(text: string, maxWidth: number, max: number, min: number): number {
  const size = Math.floor(maxWidth / (text.length * 0.58));
  return Math.max(min, Math.min(max, size));
}

export function buildOgSvg(input: OgImageInput): string {
  const { weather, dayIndex, title, provinceName, displayName } = input;
  const { daily } = weather;
  const date = daily.time[dayIndex];
  const code = daily.weatherCode[dayIndex] ?? 0;
  const hi = Math.round(daily.temperatureMax[dayIndex]);
  const lo = Math.round(daily.temperatureMin[dayIndex]);
  const prob = Math.round(daily.precipitationProbabilityMax[dayIndex] ?? 0);
  const [top, mid, bottom] = skyStops(code);

  const rel = dayIndex === 0 ? 'Bugün' : 'Yarın';
  const dateLine = `${rel}, ${dayMonth(date)} ${weekdayName(date)}`;
  const subline = provinceName ? `${provinceName} · ${dateLine}` : dateLine;

  const advice = getActivityAdvice(weather, dayIndex === 0 ? 'bugun' : 'yarin', displayName);
  const chips = (advice?.items ?? []).map((item) => ({
    label: ACTIVITY_LABEL[item.id] ?? item.title,
    verdict: item.verdict,
  }));

  const titleSize = fitFontSize(title, 740, 104, 56);
  const hiText = `${hi}°`;
  // Advance width of the big temperature (Figtree ExtraBold, 150px), so the
  // details column starts right after it.
  const hiWidth = [...hiText].reduce((w, ch) => w + (/[0-9]/.test(ch) ? 0.58 : 0.44) * 150, 0);
  const colX = Math.round(60 + hiWidth + 40);

  const chipWidth = 1072 / 3;
  const chipSvg = chips
    .map((c, i) => {
      const x = 64 + i * chipWidth + 28;
      return `
    <circle cx="${x + 9}" cy="530" r="9" fill="${VERDICT_COLOR[c.verdict]}"/>
    <text x="${x + 30}" y="517" font-size="25" font-weight="600" fill="#ffffff" fill-opacity="0.82">${esc(c.label)}</text>
    <text x="${x + 30}" y="555" font-size="34" font-weight="800" fill="#ffffff">${VERDICT_TEXT[c.verdict]}</text>`;
    })
    .join('');
  const dividers = [1, 2]
    .map((i) => `<rect x="${64 + i * chipWidth}" y="490" width="2" height="80" fill="#ffffff" fill-opacity="0.18"/>`)
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}" font-family="Figtree">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${top}"/>
      <stop offset="0.55" stop-color="${mid}"/>
      <stop offset="1" stop-color="${bottom}"/>
    </linearGradient>
  </defs>
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#sky)"/>

  <g transform="translate(64 48)">
    <rect width="52" height="52" rx="14" fill="#ffffff" fill-opacity="0.22"/>
    <g transform="translate(2 2)">${getIconSVG(2, true)}</g>
    <text x="68" y="36" font-size="30" font-weight="800" fill="#ffffff">Yarın Hava</text>
  </g>
  <text x="1136" y="84" font-size="26" font-weight="600" fill="#ffffff" fill-opacity="0.85" text-anchor="end">yarinhava.com</text>

  <text x="64" y="${148 + titleSize * 0.72}" font-size="${titleSize}" font-weight="800" fill="#ffffff">${esc(title)}</text>
  <text x="66" y="${148 + titleSize * 0.72 + 50}" font-size="32" font-weight="600" fill="#ffffff" fill-opacity="0.92">${esc(subline)}</text>

  <text x="60" y="420" font-size="150" font-weight="800" fill="#ffffff">${hiText}</text>
  <text x="${colX}" y="342" font-size="34" font-weight="800" fill="#ffffff">${esc(getWeatherDescription(code))}</text>
  <text x="${colX}" y="384" font-size="28" font-weight="600" fill="#ffffff" fill-opacity="0.9">En düşük ${lo}°</text>
  <text x="${colX}" y="420" font-size="28" font-weight="600" fill="#ffffff" fill-opacity="0.9">Yağış olasılığı %${prob}</text>

  <g transform="translate(850 150) scale(6)">${getIconSVG(code, true)}</g>

  ${chips.length ? `<rect x="64" y="478" width="1072" height="104" rx="22" fill="#0b1220" fill-opacity="0.28"/>${dividers}${chipSvg}` : ''}
</svg>`;
}
