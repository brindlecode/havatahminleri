import type { WeatherData } from './weather.ts';
import type { ClimateMonth } from './climate.ts';
import { MONTHS } from './climate.ts';
import { getAlerts, ALERT_LEVEL_LABEL, type Alert, type AlertKind } from './alerts.ts';
import { dailyNormal, signedDiff } from './normals.ts';
import { weekdayName, dayMonth } from './periodSummary.ts';
import { getCityLocative } from './utils.ts';
import { getWeatherDescription } from './weatherCodes.ts';
import { getLocationPath, SITE_ORIGIN } from './periods.ts';

/**
 * The daily Turkey weather bulletin (/bulten/).
 *
 * scripts/make-bulletin.mjs freezes the numbers of the first forecast of the
 * day into src/data/bulletins/<date>.json (81 province centres, seven days);
 * this module turns those numbers into the article. Every sentence states
 * something read from that day's data - which provinces, how much, against
 * what normal - so no two bulletins carry the same text, and a day with
 * nothing notable gets a short bulletin rather than filler.
 *
 * Wording varies from day to day: each section has several phrasings and the
 * one used is chosen by the date, rotating so that consecutive days never use
 * the same one. The choice is deterministic, so a bulletin renders the same
 * text on every build.
 */

/** One forecast day for one province: [hi, lo, weatherCode, precipitation mm, precipitation probability %, max wind km/h]. */
export type DayTuple = [number, number, number, number, number, number];

export interface BulletinFacts {
  version: 1;
  /** First forecast day (Europe/Istanbul), the day the bulletin is about. */
  date: string;
  /** When the forecast was fetched from Open-Meteo. */
  fetchedAt: string;
  /** When the bulletin was written (its publication time). */
  generatedAt: string;
  /** Dates of the stored forecast days, starting with `date`. */
  days: string[];
  provinces: { plate: number; d: DayTuple[] }[];
}

export interface ProvinceMeta {
  name: string;
  slug: string;
  plate: number;
  region: string;
}

export interface BulletinContext {
  provinces: ProvinceMeta[];
  regions: { id: string; name: string }[];
  /** Climate normals by plate; missing provinces are skipped in the anomaly section. */
  climate: Record<string, ClimateMonth[] | undefined>;
}

export interface TableRow {
  cells: { text: string; href?: string }[];
}

export interface BulletinSection {
  id: string;
  heading: string;
  paragraphs: string[];
  table?: { caption: string; head: string[]; rows: TableRow[] };
  /** Optional link under the section. */
  more?: { text: string; href: string };
}

export interface Bulletin {
  date: string;
  slug: string;
  path: string;
  url: string;
  /** <title>, at most 60 characters. */
  title: string;
  /** H1 and NewsArticle headline. */
  headline: string;
  description: string;
  lead: string;
  sections: BulletinSection[];
  datePublished: string;
  dateModified: string;
  /** Province highs for the map image. */
  mapPoints: { plate: number; temp: number }[];
  imageUrl: string;
}

// --- dates and names ----------------------------------------------------------

/** "25-ekim-2026-hava-durumu" */
export function bulletinSlug(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${d}-${MONTHS[m - 1].slug}-${y}-hava-durumu`;
}

export const bulletinPath = (date: string) => `/bulten/${bulletinSlug(date)}/`;
export const bulletinImagePath = (date: string) => `/og/bulten/${date}.png`;

const year = (date: string) => date.slice(0, 4);
/** "25 Ekim 2026 Pazar" */
export const longDate = (date: string) => `${dayMonth(date)} ${year(date)} ${weekdayName(date)}`;

/** Days since 1970-01-01, used to rotate phrasings. */
function dayNumber(date: string): number {
  return Math.floor(Date.parse(`${date}T12:00:00Z`) / 86_400_000);
}

/** Pick a phrasing: consecutive days never get the same one. */
function pick<T>(date: string, salt: number, options: T[]): T {
  return options[(dayNumber(date) + salt) % options.length];
}

/** "Rize", "Rize ve Artvin", "Rize, Artvin ve Trabzon" */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} ve ${names[names.length - 1]}`;
}

/** "Rize ve Artvin'de": the suffix goes on the last name only. */
export function joinLocative(names: string[]): string {
  if (names.length <= 1) return names.map(getCityLocative).join('');
  return `${names.slice(0, -1).join(', ')} ve ${getCityLocative(names[names.length - 1])}`;
}

const r = Math.round;
const deg = (n: number) => `${r(n)}°`;
const mm = (n: number) => `${r(n)} mm`;

// --- per-day statistics --------------------------------------------------------

const isSnow = (c: number) => (c >= 71 && c <= 77) || c === 85 || c === 86;
const isWet = (c: number) => (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95;

interface Row {
  p: ProvinceMeta;
  hi: number;
  lo: number;
  code: number;
  rain: number;
  prob: number;
  wind: number;
}

function rowsFor(facts: BulletinFacts, ctx: BulletinContext, day: number): Row[] {
  const byPlate = new Map(ctx.provinces.map((p) => [p.plate, p]));
  const out: Row[] = [];
  for (const { plate, d } of facts.provinces) {
    const p = byPlate.get(plate);
    const t = d[day];
    if (!p || !t) continue;
    out.push({ p, hi: t[0], lo: t[1], code: t[2], rain: t[3], prob: t[4], wind: t[5] });
  }
  return out;
}

const raining = (x: Row) => (isWet(x.code) || isSnow(x.code)) && x.rain >= 0.5;
const snowing = (x: Row) => isSnow(x.code) && x.rain >= 0.5;

/** The alerts.ts rules, run on a province's stored days. */
function alertsFor(facts: BulletinFacts, plate: number): Alert[] {
  const d = facts.provinces.find((x) => x.plate === plate)?.d ?? [];
  const two = d.slice(0, 2);
  const weather = {
    current: {},
    hourly: { time: [] },
    daily: {
      time: facts.days.slice(0, two.length),
      temperatureMax: two.map((t) => t[0]),
      temperatureMin: two.map((t) => t[1]),
      weatherCode: two.map((t) => t[2]),
      precipitationSum: two.map((t) => t[3]),
      precipitationProbabilityMax: two.map((t) => t[4]),
      windSpeedMax: two.map((t) => t[5]),
    },
  } as unknown as WeatherData;
  return getAlerts(weather);
}

const byDesc = <T>(f: (x: T) => number) => (a: T, b: T) => f(b) - f(a);
const byAsc = <T>(f: (x: T) => number) => (a: T, b: T) => f(a) - f(b);

const BIG_CITIES = [
  'istanbul', 'ankara', 'izmir', 'bursa', 'antalya', 'adana', 'konya',
  'gaziantep', 'diyarbakir', 'samsun', 'trabzon', 'erzurum', 'van',
];

const ALERT_PRIORITY: AlertKind[] = ['snow', 'storm', 'rain', 'wind', 'heat', 'cold'];
const ALERT_HEADLINE: Record<AlertKind, string> = {
  snow: 'kar yağışı',
  storm: 'gök gürültülü sağanak',
  rain: 'kuvvetli yağış',
  wind: 'kuvvetli rüzgar',
  heat: 'aşırı sıcak',
  cold: 'aşırı soğuk',
};

const link = (p: ProvinceMeta) => getLocationPath(p.slug);

// --- the article --------------------------------------------------------------

export function buildBulletin(facts: BulletinFacts, ctx: BulletinContext): Bulletin {
  const date = facts.date;
  const today = rowsFor(facts, ctx, 0);
  const tomorrow = rowsFor(facts, ctx, 1);
  const regionName = new Map(ctx.regions.map((x) => [x.id, x.name]));

  const hot = [...today].sort(byDesc((x) => x.hi));
  const cold = [...today].sort(byAsc((x) => x.lo));
  const wet = today.filter(raining).sort(byDesc((x) => x.rain));
  const snow = today.filter(snowing).sort(byDesc((x) => x.rain));

  const alerts = today
    .flatMap((x) => alertsFor(facts, x.p.plate).map((a) => ({ ...a, p: x.p, row: x })))
    .filter((a) => a.day === 0);

  // Anomalies against the climate normal for this date.
  const anomalies = today
    .map((x) => {
      const rows = ctx.climate[String(x.p.plate)];
      if (!rows || rows.length !== 12) return null;
      const n = dailyNormal(rows, date);
      return { x, normal: n.hi, diff: r(x.hi) - r(n.hi) };
    })
    .filter((a): a is { x: Row; normal: number; diff: number } => a !== null);
  const meanDiff = anomalies.length ? anomalies.reduce((s, a) => s + a.diff, 0) / anomalies.length : 0;

  // --- headline -----------------------------------------------------------------
  let phrase = '';
  const topAlertKind = ALERT_PRIORITY.find((k) => alerts.some((a) => a.kind === k));
  if (snow.length) {
    phrase = snow.length <= 2
      ? `${joinLocative(snow.map((x) => x.p.name))} kar yağışı`
      : `${snow.length} ilde kar yağışı bekleniyor`;
  } else if (topAlertKind) {
    const names = [...new Map(alerts.filter((a) => a.kind === topAlertKind).map((a) => [a.p.plate, a.p.name])).values()];
    phrase = names.length <= 2
      ? `${joinLocative(names)} ${ALERT_HEADLINE[topAlertKind]}`
      : `${names.length} ilde ${ALERT_HEADLINE[topAlertKind]} uyarısı`;
  } else if (Math.abs(meanDiff) >= 3 && anomalies.length >= 60) {
    phrase = meanDiff > 0 ? 'sıcaklıklar mevsim normallerinin üzerinde' : 'sıcaklıklar mevsim normallerinin altında';
  } else if (wet.length >= 15) {
    phrase = `${wet.length} ilde yağış bekleniyor`;
  } else if (wet.length === 0 && hot[0]) {
    phrase = `yurt genelinde yağışsız, en sıcak il ${hot[0].p.name}`;
  } else if (hot[0]) {
    phrase = `en sıcak il ${hot[0].p.name} (${deg(hot[0].hi)})`;
  }
  const headline = `${dayMonth(date)} ${year(date)} hava durumu${phrase ? `: ${phrase}` : ''}`;
  const titleFull = `${headline} | Yarın Hava`;
  const short = `${dayMonth(date)} hava durumu${phrase ? `: ${phrase}` : ''}`;
  const title = [titleFull, headline, short].find((t) => t.length <= 60) ?? `${dayMonth(date)} ${year(date)} Türkiye hava durumu bülteni`;

  // --- lead ---------------------------------------------------------------------
  const L = longDate(date);
  const rainPart = wet.length
    ? `${wet.length} ilde yağış bekleniyor${snow.length ? `; ${snow.length === wet.length ? 'yağış her yerde' : `${snow.length} ilde yağış`} kar şeklinde` : ''}`
    : 'kayda değer yağış beklenmiyor';
  const h = hot[0];
  const c = cold[0];
  const leads = h && c
    ? [
        `${L} Türkiye genelinde ${rainPart}. Günün en yüksek sıcaklığı ${deg(h.hi)} ile ${getCityLocative(h.p.name)}, gecenin en düşük sıcaklığı ${deg(c.lo)} ile ${getCityLocative(c.p.name)} bekleniyor.`,
        `${L} için hazırlanan model verisine göre ${rainPart}. En sıcak il ${deg(h.hi)} ile ${h.p.name}, en soğuk il ${deg(c.lo)} ile ${c.p.name}.`,
        `Türkiye'de ${L} günü ${rainPart}. Termometreler en çok ${getCityLocative(h.p.name)} yükseliyor (${deg(h.hi)}); en düşük değer ${deg(c.lo)} ile ${getCityLocative(c.p.name)}.`,
      ]
    : [`${L} Türkiye genelinde ${rainPart}.`];
  let lead = pick(date, 0, leads);
  if (anomalies.length >= 60 && Math.abs(meanDiff) >= 2) {
    lead += ` İllerin genelinde gündüz sıcaklıkları mevsim normallerinin ortalama ${deg(Math.abs(meanDiff))} ${meanDiff > 0 ? 'üzerinde' : 'altında'}.`;
  }

  const sections: BulletinSection[] = [];

  // --- warnings -----------------------------------------------------------------
  if (alerts.length) {
    const groups = new Map<string, typeof alerts>();
    for (const a of alerts) {
      const key = `${a.kind}|${a.level}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(a);
    }
    const paragraphs = [...groups.values()]
      .sort((a, b) => b[0].level - a[0].level || ALERT_PRIORITY.indexOf(a[0].kind) - ALERT_PRIORITY.indexOf(b[0].kind))
      .map((g) => {
        const names = [...new Map(g.map((a) => [a.p.plate, a.p.name])).values()];
        const shown = names.slice(0, 8);
        const rest = names.length - shown.length;
        return `${g[0].title} (${ALERT_LEVEL_LABEL[g[0].level]}): ${joinNames(shown)}${rest > 0 ? ` ve ${rest} il daha` : ''}. ${g[0].detail.split('. ').slice(-1)[0]}`;
      });
    paragraphs.push(
      'Bu uyarılar Yarın Hava\'nın model verisine dayanan kendi değerlendirmesidir; resmi uyarılar için Meteoroloji Genel Müdürlüğü\'nü takip edin.',
    );
    sections.push({
      id: 'uyarilar',
      heading: 'Öne çıkan uyarılar',
      paragraphs,
      more: { text: 'Tüm iller için hava uyarıları', href: '/hava-uyarilari/' },
    });
  }

  // --- temperatures -------------------------------------------------------------
  if (hot.length >= 5 && cold.length >= 5) {
    const [a, b, c2] = hot;
    const tempParas = [
      pick(date, 1, [
        `Bugün en sıcak il ${deg(a.hi)} ile ${a.p.name}. ${b.p.name} (${deg(b.hi)}) ve ${c2.p.name} (${deg(c2.hi)}) onu izliyor.`,
        `Sıcaklık en çok ${getCityLocative(a.p.name)} yükseliyor: ${deg(a.hi)}. Ardından ${b.p.name} ${deg(b.hi)} ve ${c2.p.name} ${deg(c2.hi)} geliyor.`,
        `${a.p.name} ${deg(a.hi)} ile günün en sıcak ili; ${b.p.name} ve ${c2.p.name} sırasıyla ${deg(b.hi)} ve ${deg(c2.hi)} bekliyor.`,
      ]),
      pick(date, 2, [
        `Gece en soğuk yer ${cold[0].p.name}: sıcaklık ${deg(cold[0].lo)}'ye kadar düşüyor.`,
        `En düşük gece sıcaklığı ${deg(cold[0].lo)} ile ${getCityLocative(cold[0].p.name)} bekleniyor; ${cold[1].p.name} ${deg(cold[1].lo)} ile onu izliyor.`,
        `Gecenin en soğuk illeri ${cold[0].p.name} (${deg(cold[0].lo)}) ve ${cold[1].p.name} (${deg(cold[1].lo)}).`,
      ]),
    ];
    const frost = today.filter((x) => x.lo <= 0);
    if (frost.length) {
      tempParas.push(`${frost.length} ilde gece sıcaklığı 0° veya altına iniyor; bu illerde don ve buzlanmaya dikkat.`);
    }
    const big = BIG_CITIES.map((s) => today.find((x) => x.p.slug === s)).filter((x): x is Row => Boolean(x)).slice(0, 3);
    if (big.length === 3) {
      tempParas.push(`Büyük şehirlerde gündüz sıcaklığı ${big.map((x) => `${getCityLocative(x.p.name)} ${deg(x.hi)}`).join(', ')}.`);
    }
    sections.push({
      id: 'sicakliklar',
      heading: 'Sıcaklıklar',
      paragraphs: tempParas,
      table: {
        caption: 'En sıcak ve en soğuk beş il',
        head: ['En sıcak', 'En yüksek', 'En soğuk', 'En düşük'],
        rows: [0, 1, 2, 3, 4].map((i) => ({
          cells: [
            { text: hot[i].p.name, href: link(hot[i].p) },
            { text: deg(hot[i].hi) },
            { text: cold[i].p.name, href: link(cold[i].p) },
            { text: deg(cold[i].lo) },
          ],
        })),
      },
    });
  }

  // --- precipitation ------------------------------------------------------------
  {
    const paragraphs: string[] = [];
    if (!wet.length) {
      paragraphs.push(pick(date, 3, [
        'Bugün 81 ilin hiçbirinde kayda değer yağış beklenmiyor.',
        'Yurt genelinde bugün yağış beklenmiyor; gökyüzü bulutlu olsa da yağış ihtimali düşük.',
        'Türkiye genelinde bugün kuru bir gün bekleniyor.',
      ]));
    } else {
      const top = wet.slice(0, 3);
      paragraphs.push(pick(date, 3, [
        `Bugün ${wet.length} ilde yağış bekleniyor. En fazla yağış ${top.map((x) => `${x.p.name} (${mm(x.rain)})`).join(', ')} için öngörülüyor.`,
        `Yağışın en yoğun olduğu iller ${joinNames(top.map((x) => `${x.p.name} (${mm(x.rain)})`))}; toplamda ${wet.length} ilde yağış var.`,
        `${wet.length} ilde yağışlı bir gün bekleniyor. ${getCityLocative(top[0].p.name)} toplam yağış ${mm(top[0].rain)} ile en yüksek seviyede.`,
      ]));
      if (snow.length) {
        paragraphs.push(`Kar yağışı beklenen iller: ${joinNames(snow.slice(0, 8).map((x) => x.p.name))}${snow.length > 8 ? ` ve ${snow.length - 8} il daha` : ''}.`);
      }
    }
    sections.push({
      id: 'yagis',
      heading: 'Yağış',
      paragraphs,
      table: wet.length >= 3
        ? {
            caption: 'En çok yağış beklenen iller',
            head: ['İl', 'Toplam yağış', 'Olasılık', 'Durum'],
            rows: wet.slice(0, 8).map((x) => ({
              cells: [
                { text: x.p.name, href: link(x.p) },
                { text: mm(x.rain) },
                { text: `%${r(x.prob)}` },
                { text: getWeatherDescription(x.code) },
              ],
            })),
          }
        : undefined,
      more: { text: 'Saat saat yağış haritası', href: '/yagis-haritasi/' },
    });
  }

  // --- against the season -------------------------------------------------------
  if (anomalies.length >= 60) {
    const above = anomalies.filter((a) => a.diff >= 2).length;
    const below = anomalies.filter((a) => a.diff <= -2).length;
    const around = anomalies.length - above - below;
    const warm = [...anomalies].sort(byDesc((a) => a.diff)).slice(0, 3);
    const coolest = [...anomalies].sort(byAsc((a) => a.diff)).slice(0, 3);
    const paragraphs = [
      pick(date, 4, [
        `${dayMonth(date)} için mevsim normalleriyle karşılaştırıldığında gündüz sıcaklığı ${above} ilde normalin üzerinde, ${below} ilde altında, ${around} ilde normal civarında.`,
        `Mevsim normallerine göre bugün ${above} il daha sıcak, ${below} il daha serin; ${around} ilde sıcaklıklar mevsimine uygun.`,
      ]),
    ];
    if (warm[0].diff >= 2) {
      paragraphs.push(`Normale göre en sıcak iller: ${warm.filter((a) => a.diff >= 2).map((a) => `${a.x.p.name} (${signedDiff(a.diff)})`).join(', ')}.`);
    }
    if (coolest[0].diff <= -2) {
      paragraphs.push(`Normale göre en serin iller: ${coolest.filter((a) => a.diff <= -2).map((a) => `${a.x.p.name} (${signedDiff(a.diff)})`).join(', ')}.`);
    }
    sections.push({
      id: 'mevsim-normalleri',
      heading: 'Mevsim normallerine göre',
      paragraphs,
    });
  }

  // --- regions ------------------------------------------------------------------
  {
    const rows = ctx.regions
      .map((reg) => {
        const xs = today.filter((x) => x.p.region === reg.id);
        if (!xs.length) return null;
        const avg = xs.reduce((s, x) => s + x.hi, 0) / xs.length;
        const rainy = xs.filter(raining).length;
        return { reg, xs, avg, rainy, min: Math.min(...xs.map((x) => x.hi)), max: Math.max(...xs.map((x) => x.hi)) };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (rows.length >= 3) {
      const warmest = [...rows].sort(byDesc((x) => x.avg))[0];
      const coolest = [...rows].sort(byAsc((x) => x.avg))[0];
      const wettest = [...rows].sort((a, b) => b.rainy - a.rainy || b.rainy / b.xs.length - a.rainy / a.xs.length)[0];
      const paragraphs = [
        pick(date, 5, [
          `Bölgeler arasında en sıcak ${warmest.reg.name} (il merkezlerinde ortalama ${deg(warmest.avg)}), en serin ${coolest.reg.name} (${deg(coolest.avg)}).`,
          `Ortalama gündüz sıcaklığı ${warmest.reg.name} için ${deg(warmest.avg)}, ${coolest.reg.name} için ${deg(coolest.avg)}.`,
        ]),
      ];
      if (wettest.rainy > 0) {
        paragraphs.push(`Yağış en yaygın ${wettest.reg.name} içinde: ${wettest.xs.length} ilin ${wettest.rainy === wettest.xs.length ? 'tamamında' : `${wettest.rainy} tanesinde`} yağış bekleniyor.`);
      }
      sections.push({
        id: 'bolgeler',
        heading: 'Bölgelere göre',
        paragraphs,
        table: {
          caption: 'Bölgelere göre gündüz sıcaklıkları ve yağış',
          head: ['Bölge', 'Gündüz sıcaklığı', 'Yağışlı il'],
          rows: rows.map((x) => ({
            cells: [
              { text: x.reg.name },
              { text: `${deg(x.min)} - ${deg(x.max)}` },
              { text: `${x.rainy} / ${x.xs.length}` },
            ],
          })),
        },
      });
    }
  }

  // --- big cities ---------------------------------------------------------------
  {
    const rows = BIG_CITIES.map((s) => {
      const a = today.find((x) => x.p.slug === s);
      const b = tomorrow.find((x) => x.p.slug === s);
      return a && b ? { a, b } : null;
    }).filter((x): x is { a: Row; b: Row } => x !== null);
    if (rows.length >= 5) {
      sections.push({
        id: 'buyuk-sehirler',
        heading: 'Büyük şehirlerde hava',
        paragraphs: [],
        table: {
          caption: `Büyük şehirlerde ${dayMonth(date)} ve ${dayMonth(facts.days[1])} tahmini (en yüksek / en düşük)`,
          head: ['Şehir', dayMonth(date), dayMonth(facts.days[1])],
          rows: rows.map(({ a, b }) => ({
            cells: [
              { text: a.p.name, href: link(a.p) },
              { text: `${deg(a.hi)} / ${deg(a.lo)}, ${getWeatherDescription(a.code).toLocaleLowerCase('tr')}` },
              { text: `${deg(b.hi)} / ${deg(b.lo)}, ${getWeatherDescription(b.code).toLocaleLowerCase('tr')}` },
            ],
          })),
        },
      });
    }
  }

  // --- every province ---------------------------------------------------------
  if (today.length >= 60) {
    const all = [...today].sort((a, b) => a.p.name.localeCompare(b.p.name, 'tr'));
    sections.push({
      id: 'tum-iller',
      heading: `81 ilde ${dayMonth(date)} hava durumu`,
      paragraphs: [],
      table: {
        caption: `İl merkezlerinde ${dayMonth(date)} tahmini`,
        head: ['İl', 'En yüksek / en düşük', 'Yağış', 'Durum'],
        rows: all.map((x) => ({
          cells: [
            { text: x.p.name, href: link(x.p) },
            { text: `${deg(x.hi)} / ${deg(x.lo)}` },
            { text: raining(x) ? mm(x.rain) : '-' },
            { text: getWeatherDescription(x.code) },
          ],
        })),
      },
    });
  }

  // --- tomorrow -----------------------------------------------------------------
  if (tomorrow.length >= 60 && facts.days[1]) {
    const both = today
      .map((x) => ({ x, y: tomorrow.find((t) => t.p.plate === x.p.plate) }))
      .filter((z): z is { x: Row; y: Row } => Boolean(z.y));
    const change = both.reduce((s, z) => s + (z.y.hi - z.x.hi), 0) / both.length;
    const wetT = tomorrow.filter(raining);
    const snowT = tomorrow.filter(snowing);
    const hotT = [...tomorrow].sort(byDesc((x) => x.hi))[0];
    const when = `${dayMonth(facts.days[1])} ${weekdayName(facts.days[1])}`;
    const trend = Math.abs(change) < 1
      ? 'sıcaklıklarda belirgin bir değişiklik beklenmiyor'
      : `sıcaklıklar yurt genelinde ortalama ${deg(Math.abs(change))} ${change > 0 ? 'artıyor' : 'düşüyor'}`;
    const paragraphs = [
      pick(date, 6, [
        `Yarın (${when}) ${trend}. ${wetT.length ? `${wetT.length} ilde yağış bekleniyor` : 'Yağış beklenmiyor'}${snowT.length ? `; ${snowT.length} ilde kar` : ''}. En sıcak il ${hotT.p.name} (${deg(hotT.hi)}).`,
        `${when} günü ${trend}. Yağış beklenen il sayısı ${wetT.length}${snowT.length ? `, kar beklenen il sayısı ${snowT.length}` : ''}; en yüksek sıcaklık ${deg(hotT.hi)} ile ${getCityLocative(hotT.p.name)}.`,
      ]),
    ];
    sections.push({ id: 'yarin', heading: `Yarın: ${when}`, paragraphs });
  }

  // --- weekend (bulletins of Thursday and Friday) -----------------------------
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (dow === 4 || dow === 5) {
    const sat = 6 - dow;
    const sun = sat + 1;
    if (facts.days[sun]) {
      const s = rowsFor(facts, ctx, sat);
      const z = rowsFor(facts, ctx, sun);
      const cities = ['istanbul', 'ankara', 'izmir', 'antalya']
        .map((slug) => ({ a: s.find((x) => x.p.slug === slug), b: z.find((x) => x.p.slug === slug) }))
        .filter((x): x is { a: Row; b: Row } => Boolean(x.a && x.b));
      const paragraphs = [
        `Hafta sonu (${dayMonth(facts.days[sat])}-${dayMonth(facts.days[sun])}) Cumartesi ${s.filter(raining).length} ilde, Pazar ${z.filter(raining).length} ilde yağış bekleniyor.`,
      ];
      if (cities.length) {
        paragraphs.push(`Cumartesi ve Pazar en yüksek sıcaklıklar: ${cities.map(({ a, b }) => `${a.p.name} ${deg(a.hi)} / ${deg(b.hi)}`).join(', ')}.`);
      }
      sections.push({ id: 'hafta-sonu', heading: 'Hafta sonu', paragraphs });
    }
  }

  // The long all-provinces table reads best at the end.
  sections.sort((a, b) => Number(a.id === 'tum-iller') - Number(b.id === 'tum-iller'));

  // --- description --------------------------------------------------------------
  const descBase = `${L} Türkiye geneli hava durumu: ${rainPart}`;
  const descExtra = h ? `, en sıcak il ${h.p.name} (${deg(h.hi)})` : '';
  let description = `${descBase}${descExtra}. İl il sıcaklık, yağış ve uyarılar.`;
  if (description.length > 155) description = `${descBase}${descExtra}.`;
  if (description.length > 155) description = `${descBase}.`;

  const path = bulletinPath(date);
  return {
    date,
    slug: bulletinSlug(date),
    path,
    url: `${SITE_ORIGIN}${path}`,
    title,
    headline,
    description,
    lead,
    sections,
    datePublished: facts.generatedAt,
    dateModified: facts.generatedAt,
    mapPoints: today.map((x) => ({ plate: x.p.plate, temp: r(x.hi) })),
    imageUrl: `${SITE_ORIGIN}${bulletinImagePath(date)}`,
  };
}

/** Plain text of a bulletin (lead and paragraphs), for tests and word counts. */
export function bulletinText(b: Bulletin): string {
  return [b.lead, ...b.sections.flatMap((s) => s.paragraphs)].join(' ');
}
