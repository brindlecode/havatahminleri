import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Monthly climate normals per province (src/data/climate.json, written by
 * scripts/fetch-climate.mjs through .github/workflows/climate.yml). The file
 * fills in a batch of provinces per day; a province's climate pages exist
 * once its row does.
 */

export interface ClimateMonth {
  hi: number;
  lo: number;
  mean: number;
  /** Mean monthly total, mm. */
  precip: number;
  rainyDays: number;
  snowyDays: number;
  hotDays: number;
  frostDays: number;
  /** Mean sunshine hours per day. */
  sunHours: number;
  windMax: number;
  recordHi: number;
  recordHiYear: number;
  recordLo: number;
  recordLoYear: number;
}

export interface ClimateFile {
  period?: string;
  source?: string;
  updatedAt?: string;
  provinces?: Record<string, ClimateMonth[]>;
}

export const MONTHS = [
  { slug: 'ocak', name: 'Ocak' },
  { slug: 'subat', name: 'Şubat' },
  { slug: 'mart', name: 'Mart' },
  { slug: 'nisan', name: 'Nisan' },
  { slug: 'mayis', name: 'Mayıs' },
  { slug: 'haziran', name: 'Haziran' },
  { slug: 'temmuz', name: 'Temmuz' },
  { slug: 'agustos', name: 'Ağustos' },
  { slug: 'eylul', name: 'Eylül' },
  { slug: 'ekim', name: 'Ekim' },
  { slug: 'kasim', name: 'Kasım' },
  { slug: 'aralik', name: 'Aralık' },
] as const;

/** Locative of a month name: "Ocak'ta", "Şubat'ta", "Eylül'de", "Nisan'da". */
export const MONTH_LOCATIVE = [
  "Ocak'ta", "Şubat'ta", "Mart'ta", "Nisan'da", "Mayıs'ta", "Haziran'da",
  "Temmuz'da", "Ağustos'ta", "Eylül'de", "Ekim'de", "Kasım'da", "Aralık'ta",
];

let cache: ClimateFile | null = null;
export function loadClimate(): ClimateFile {
  if (cache) return cache;
  const path = resolve(process.cwd(), 'src/data/climate.json');
  try {
    cache = existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')) : {};
  } catch {
    cache = {};
  }
  return cache!;
}

export function getClimate(plate: number): ClimateMonth[] | null {
  const rows = loadClimate().provinces?.[plate];
  return Array.isArray(rows) && rows.length === 12 ? rows : null;
}

export const climatePeriod = () => loadClimate().period ?? '2015-2024';

export const climatePath = (provinceSlug: string, month?: number) =>
  `/${provinceSlug}-hava-durumu/iklim/${month === undefined ? '' : `${MONTHS[month].slug}/`}`;

const fmt = (n: number) => n.toLocaleString('tr-TR', { maximumFractionDigits: 1 });
const r = Math.round;

/** What the month feels like, from its average high and low. */
export function monthFeel(m: ClimateMonth): string {
  if (m.hi >= 33) return 'çok sıcak';
  if (m.hi >= 28) return 'sıcak';
  if (m.hi >= 22) return 'ılık';
  if (m.hi >= 15) return 'serin';
  if (m.hi >= 7) return 'soğuk';
  return 'çok soğuk';
}

/** What to wear, for the clothing paragraph. */
export function clothing(m: ClimateMonth): string {
  if (m.hi >= 30) return 'İnce, açık renkli, pamuklu kıyafetler; şapka, güneş gözlüğü ve güneş kremi.';
  if (m.hi >= 24) return m.lo < 16
    ? 'Gündüz tişört ve ince giysiler yeter; akşamlar için ince bir hırka ya da ceket alın.'
    : 'Gündüz ve akşam ince yazlık kıyafetler yeterli; güneş kremini unutmayın.';
  if (m.hi >= 17) return 'Katmanlı giyinin: uzun kollu üst, hafif ceket ya da trençkot; akşamları serinler.';
  if (m.hi >= 9) return 'Mont ya da kalın ceket, kazak ve kapalı ayakkabı; yağışlı günler için şemsiye.';
  return 'Kalın kaban, bere, eldiven, atkı ve su geçirmez, kaymayan bot.';
}

/** Two-to-three sentence answer for "<il>'da <ay> ayında hava nasıl?". */
export function monthAnswer(locative: string, month: number, m: ClimateMonth): string {
  const parts = [
    `${locative} ${MONTHS[month].name.toLocaleLowerCase('tr')} ayında hava genellikle ${monthFeel(m)} geçer: gündüz sıcaklığı ortalama ${r(m.hi)}°, gece ${r(m.lo)}° civarındadır.`,
  ];
  if (m.precip < 10) {
    parts.push(`Ay neredeyse kuru geçer; ortalama yağış ${r(m.precip)} mm'dir.`);
  } else {
    parts.push(`Ay boyunca ortalama ${r(m.precip)} mm yağış düşer ve yaklaşık ${r(m.rainyDays)} gün yağışlıdır.`);
  }
  if (m.snowyDays >= 1) parts.push(`Ayda ortalama ${r(m.snowyDays)} gün kar yağar.`);
  parts.push(`Günde ortalama ${fmt(m.sunHours)} saat güneş görülür.`);
  return parts.join(' ');
}
