import { getWeatherDescription } from './weatherCodes.ts';
import { getCityLocative } from './utils.ts';
import { getForecastFreshness } from './freshness.ts';
import {
  PERIOD_DEFS,
  SITE_ORIGIN,
  getCanonicalForPeriod,
  getLocationPath,
  type PeriodId,
} from './periods.ts';
import districtsData from '../data/districts.json' with { type: 'json' };

export interface SEOData {
  title: string;
  description: string;
  canonical: string;
  /** H1 shown on the page. Always agrees with the title's intent. */
  heading: string;
  /**
   * Name for JSON-LD (`generateStructuredData({ name })`), e.g.
   * "Ortaköy, Çorum 15 Günlük Hava Durumu". Location pages only.
   */
  schemaName?: string;
}

/**
 * A province or district, resolved into the names the templates need.
 */
export interface LocationRef {
  provinceName: string;
  provinceSlug: string;
  districtName?: string;
  districtSlug?: string;
  lat: number;
  lon: number;
}

export interface LocationNames {
  /** How the place is referred to in prose (short, no province). */
  short: string;
  /** Disambiguated name for titles ("İzmit, Kocaeli"). */
  qualified: string;
  /**
   * Name for the H1, meta description and standalone answers. Equal to
   * `short`, except for district names shared by more than one province,
   * which carry the province in parentheses: "Ortaköy (Çorum)".
   */
  display: string;
  isDistrict: boolean;
}

/** District names (excluding "Merkez") that occur in more than one province. */
const AMBIGUOUS_DISTRICT_NAMES: ReadonlySet<string> = (() => {
  const provincesByName = new Map<string, Set<string>>();
  for (const d of districtsData as { name: string; province: string }[]) {
    if (!provincesByName.has(d.name)) provincesByName.set(d.name, new Set());
    provincesByName.get(d.name)!.add(d.province);
  }
  return new Set(
    [...provincesByName].filter(([name, provs]) => name !== 'Merkez' && provs.size > 1).map(([name]) => name),
  );
})();

/** True when `districtName` exists in more than one province (e.g. "Ortaköy"). */
export function isAmbiguousDistrictName(districtName: string): boolean {
  return AMBIGUOUS_DISTRICT_NAMES.has(districtName);
}

/**
 * 51 of the 969 districts are literally named "Merkez" (the provincial
 * centre). Rendering "Merkez Hava Durumu" as an H1 on 51 x 7 = 357 pages is
 * both meaningless to a reader and a duplicate-title signal, so those get the
 * province prefixed. 23 further district names are shared by more than one
 * province; titles always carry the province, and for those 23 names the
 * H1 and meta description do too (`display`).
 */
export function getLocationNames(loc: LocationRef): LocationNames {
  if (!loc.districtName) {
    const n = loc.provinceName;
    return { short: n, qualified: n, display: n, isDistrict: false };
  }
  if (loc.districtName === 'Merkez') {
    const name = `${loc.provinceName} Merkez`;
    return { short: name, qualified: name, display: name, isDistrict: true };
  }
  return {
    short: loc.districtName,
    qualified: `${loc.districtName}, ${loc.provinceName}`,
    display: isAmbiguousDistrictName(loc.districtName)
      ? `${loc.districtName} (${loc.provinceName})`
      : loc.districtName,
    isDistrict: true,
  };
}

/** Longest title Google reliably shows without truncation (approx. 580px). */
export const TITLE_MAX = 60;
export const DESCRIPTION_MIN = 120;
export const DESCRIPTION_MAX = 155;

/** First candidate that fits TITLE_MAX, else the shortest (last) one. */
function fitTitle(candidates: string[]): string {
  return candidates.find((c) => c.length <= TITLE_MAX) ?? candidates[candidates.length - 1];
}

function clampDescription(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= DESCRIPTION_MAX) return collapsed;
  const cut = collapsed.slice(0, DESCRIPTION_MAX - 3);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > DESCRIPTION_MIN ? lastSpace : cut.length).trimEnd()}...`;
}

/**
 * Build a description from a lead sentence plus optional sentences, added in
 * order while the text stays within DESCRIPTION_MAX. An optional item may be
 * a list of alternatives (longest first); the first that fits is used. `pad`
 * sentences only lift a short description up towards DESCRIPTION_MIN.
 */
function fitDescription(lead: string, optional: (string | string[] | null)[], pad: string[] = []): string {
  let text = lead.replace(/\s+/g, ' ').trim();
  const tryAdd = (part: string | string[]) => {
    for (const alt of Array.isArray(part) ? part : [part]) {
      const next = `${text} ${alt}`;
      if (next.length <= DESCRIPTION_MAX) {
        text = next;
        return;
      }
    }
  };
  for (const part of optional) if (part) tryAdd(part);
  for (const part of pad) if (text.length < DESCRIPTION_MIN) tryAdd(part);
  return clampDescription(text);
}

const BRAND = ' | Yarın Hava';

/**
 * Title, description, canonical and H1 for one location + period.
 *
 * Search-intent ownership is deliberate and non-overlapping:
 *
 *   /{location}/            -> tomorrow + current conditions (the brand is
 *                              "Yarın Hava"; this is the location's main page)
 *   /{location}/bugun/      -> today
 *   /{location}/yarin/      -> tomorrow (legacy; duplicates the base URL, see
 *                              docs/seo-recovery-plan.md)
 *   /{location}/7-gunluk/   -> 7 days
 *   /{location}/10-gunluk/  -> 10 days
 *   /{location}/15-gunluk/  -> 15 days
 *   /{location}/saatlik/    -> next 48 hours
 *
 * Titles keep the primary keyword ("<Yer> 15 Günlük Hava Durumu") first and
 * shed the trailing qualifier and then the " | Yarın Hava" brand suffix when
 * they would otherwise exceed TITLE_MAX characters. The H1 (`heading`) and the
 * description use `display`, so shared district names carry their province.
 */
export function getPeriodSEO(
  loc: LocationRef,
  periodId: PeriodId,
  weather?: { temperature: number; weatherCode: number; maxTemp?: number; minTemp?: number },
): SEOData {
  const core = periodSEOCore(loc, periodId, weather);
  const names = getLocationNames(loc);
  // heading always starts with names.display; swap in the qualified form.
  return { ...core, schemaName: `${names.qualified}${core.heading.slice(names.display.length)}` };
}

function periodSEOCore(
  loc: LocationRef,
  periodId: PeriodId,
  weather?: { temperature: number; weatherCode: number; maxTemp?: number; minTemp?: number },
): Omit<SEOData, 'schemaName'> {
  const names = getLocationNames(loc);
  const canonical = getCanonicalForPeriod(loc.provinceSlug, periodId, loc.districtSlug);
  const q = names.qualified;
  const d = names.display;
  const locative = getCityLocative(d);

  const cond = weather ? getWeatherDescription(weather.weatherCode).toLowerCase() : null;
  const nowTemp = weather ? `${Math.round(weather.temperature)}°C` : null;
  const range =
    weather?.maxTemp !== undefined && weather?.minTemp !== undefined
      ? `${Math.round(weather.minTemp)}°C - ${Math.round(weather.maxTemp)}°C`
      : null;
  const PAD = ['Her gün güncellenir.', 'Kaynak: Open-Meteo.'];

  switch (periodId) {
    case 'bugun':
      return {
        title: fitTitle([
          `${q} Bugün Hava Durumu - Saatlik Tahmin${BRAND}`,
          `${q} Bugün Hava Durumu${BRAND}`,
          `${q} Bugün Hava Durumu - Saatlik Tahmin`,
          `${q} Bugün Hava Durumu`,
        ]),
        description: fitDescription(
          `${locative} bugün hava durumu${cond ? `: şu an ${nowTemp}, ${cond}` : ''}.`,
          [
            range ? `Gün içi ${range} aralığında.` : null,
            [
              'Saat saat sıcaklık, yağış olasılığı, rüzgar ve gün doğumu-batımı bilgileri.',
              'Saat saat sıcaklık, yağış olasılığı ve rüzgar bilgileri.',
              'Saat saat sıcaklık ve yağış.',
            ],
          ],
          PAD,
        ),
        canonical,
        heading: `${d} Bugün Hava Durumu`,
      };

    case 'yarin':
      return {
        title: fitTitle([
          `${q} Yarın Hava Durumu - Saatlik Tahmin${BRAND}`,
          `${q} Yarın Hava Durumu${BRAND}`,
          `${q} Yarın Hava Durumu - Saatlik Tahmin`,
          `${q} Yarın Hava Durumu`,
        ]),
        description: fitDescription(
          `${locative} yarın hava nasıl olacak?`,
          [
            [
              'Yarının en yüksek ve en düşük sıcaklığı, saatlik tahmin, yağış olasılığı ve bugüne göre sıcaklık farkı bu sayfada.',
              'Yarının en yüksek ve en düşük sıcaklığı, saatlik tahmin, yağış olasılığı ve bugüne göre fark.',
              'Yarının en yüksek-en düşük sıcaklığı, saatlik tahmin ve yağış olasılığı.',
            ],
          ],
          PAD,
        ),
        canonical,
        heading: `${d} Yarın Hava Durumu`,
      };

    case '7gun':
      return {
        title: fitTitle([
          `${q} 7 Günlük Hava Durumu Tahmini${BRAND}`,
          `${q} 7 Günlük Hava Durumu${BRAND}`,
          `${q} 7 Günlük Hava Durumu`,
        ]),
        description: fitDescription(
          `${d} 7 günlük hava durumu tahmini.`,
          [[
            'Haftalık sıcaklık eğilimi, en sıcak ve en serin günler, yağışlı gün sayısı ve hafta sonu karşılaştırması.',
            'Haftalık sıcaklık eğilimi, en sıcak ve en serin günler ve yağışlı gün sayısı.',
            'Haftalık sıcaklık eğilimi ve yağışlı gün sayısı.',
          ]],
          PAD,
        ),
        canonical,
        heading: `${d} 7 Günlük Hava Durumu`,
      };

    case '10gun':
      return {
        title: fitTitle([
          `${q} 10 Günlük Hava Durumu Tahmini${BRAND}`,
          `${q} 10 Günlük Hava Durumu${BRAND}`,
          `${q} 10 Günlük Hava Durumu`,
        ]),
        description: fitDescription(
          `${d} 10 günlük hava durumu tahmini.`,
          [[
            'İlk 5 gün ile sonraki 5 günün karşılaştırması, sıcaklık eğilimi ve yağış dağılımı ile günlük tablo.',
            'İlk 5 gün ile sonraki 5 günün karşılaştırması, sıcaklık eğilimi ve yağış dağılımı.',
            'Sıcaklık eğilimi, yağış dağılımı ve günlük tablo.',
          ]],
          PAD,
        ),
        canonical,
        heading: `${d} 10 Günlük Hava Durumu`,
      };

    case '15gun':
      return {
        title: fitTitle([
          `${q} 15 Günlük Hava Durumu Tahmini${BRAND}`,
          `${q} 15 Günlük Hava Durumu${BRAND}`,
          `${q} 15 Günlük Hava Durumu`,
        ]),
        description: fitDescription(
          `${d} 15 günlük hava durumu.`,
          [[
            'Her gün için en yüksek-en düşük sıcaklık, yağışlı gün sayısı, en sıcak ve en serin dönemler ve uzun vadeli eğilim.',
            'Günlük en yüksek-en düşük sıcaklık, yağışlı gün sayısı, en sıcak ve en serin dönemler.',
            'Günlük en yüksek-en düşük sıcaklık, yağışlı gün sayısı ve uzun vadeli eğilim.',
          ]],
          PAD,
        ),
        canonical,
        heading: `${d} 15 Günlük Hava Durumu`,
      };

    case 'saatlik':
      return {
        title: fitTitle([
          `${q} Saatlik Hava Durumu - 48 Saat${BRAND}`,
          `${q} Saatlik Hava Durumu${BRAND}`,
          `${q} Saatlik Hava Durumu - 48 Saat`,
          `${q} Saatlik Hava Durumu`,
        ]),
        description: fitDescription(
          `${locative} saatlik hava durumu.`,
          [[
            'Önümüzdeki 48 saat için saat saat sıcaklık, yağış olasılığı, rüzgar hızı ve gece-gündüz geçişleri.',
            'Önümüzdeki 48 saat için saat saat sıcaklık, yağış olasılığı ve rüzgar hızı.',
            '48 saat boyunca saat saat sıcaklık, yağış ve rüzgar.',
          ]],
          PAD,
        ),
        canonical,
        heading: `${d} Saatlik Hava Durumu`,
      };

    case 'base':
    default:
      return {
        title: fitTitle([
          `${q} Hava Durumu: Yarın ve Saatlik Tahmin${BRAND}`,
          `${q} Hava Durumu: Yarın ve Saatlik Tahmin`,
          `${q} Hava Durumu - Yarın ve Saatlik`,
          `${q} Hava Durumu${BRAND}`,
          `${q} Hava Durumu`,
        ]),
        description: fitDescription(
          `${locative} hava durumu${cond ? `: şu an ${nowTemp}, ${cond}` : ''}.`,
          [[
            'Yarının saatlik tahmini, en yüksek ve en düşük sıcaklık, yağış olasılığı ve rüzgar bilgileri.',
            'Yarının saatlik tahmini, en yüksek ve en düşük sıcaklık ve yağış olasılığı.',
            'Yarının saatlik tahmini, sıcaklık ve yağış olasılığı.',
          ]],
          PAD,
        ),
        canonical,
        heading: `${d} Hava Durumu`,
      };
  }
}

export function getHomeSEO(): SEOData {
  return {
    title: 'Yarın Hava - Türkiye Hava Durumu ve Yarınki Tahmin',
    description:
      'Türkiye hava durumu: 81 il ve 969 ilçe için yarınki ve saatlik tahmin. Bugün, 7, 10 ve 15 günlük ' +
      'sıcaklık, yağış ve rüzgar bilgileri her gün güncellenir.',
    canonical: `${SITE_ORIGIN}/`,
    heading: 'Türkiye Hava Durumu',
  };
}

// --- structured data ---------------------------------------------------------

/** The publisher entity, with the logo Google uses for Organization. */
const ORGANIZATION = {
  '@type': 'Organization',
  name: 'Yarın Hava',
  url: `${SITE_ORIGIN}/`,
  logo: {
    '@type': 'ImageObject',
    url: `${SITE_ORIGIN}/icon-512.png`,
    width: 512,
    height: 512,
  },
} as const;

/**
 * Breadcrumb trail for a location page. URLs are absolute, as
 * schema.org/BreadcrumbList requires.
 */
export function buildBreadcrumbs(
  loc: LocationRef,
  periodId: PeriodId,
  regionName?: string,
): { name: string; url: string }[] {
  const names = getLocationNames(loc);
  const crumbs: { name: string; url: string }[] = [];

  // Regions have no page of their own; a crumb pointing at the home page
  // listed the home URL twice in every BreadcrumbList. `regionName` is kept
  // in the signature for when real region pages exist.
  void regionName;

  crumbs.push({
    name: `${loc.provinceName} Hava Durumu`,
    url: `${SITE_ORIGIN}${getLocationPath(loc.provinceSlug)}`,
  });

  if (loc.districtSlug) {
    crumbs.push({
      name: `${names.short} Hava Durumu`,
      url: `${SITE_ORIGIN}${getLocationPath(loc.provinceSlug, loc.districtSlug)}`,
    });
  }

  if (periodId !== 'base') {
    crumbs.push({
      name: PERIOD_DEFS[periodId].label,
      url: getCanonicalForPeriod(loc.provinceSlug, periodId, loc.districtSlug),
    });
  }

  return crumbs;
}

/**
 * JSON-LD for a page.
 *
 * Deliberately omitted:
 *   - FAQPage: since August 2023 Google shows FAQ rich results only for
 *     authoritative government and health sites, so it would add weight with
 *     no eligible result. The Q&A is rendered as visible content instead.
 *   - SpeakableSpecification: limited to a closed news pilot in en-US.
 *
 * `dateModified` is the timestamp the forecast data was fetched, never the
 * build time - a rebuild that reuses an old cache must not claim to be new.
 */
export function generateStructuredData(
  type: 'home' | 'location',
  data: {
    name: string;
    description: string;
    url: string;
    lat?: number;
    lon?: number;
    breadcrumbs?: { name: string; url: string }[];
  },
): string {
  const jsonLd: Record<string, unknown>[] = [];
  const freshness = getForecastFreshness();

  const webPage: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: data.name,
    description: data.description,
    url: data.url,
    inLanguage: 'tr-TR',
    isPartOf: { '@type': 'WebSite', name: 'Yarın Hava', url: `${SITE_ORIGIN}/` },
    publisher: ORGANIZATION,
  };

  if (freshness) {
    webPage.dateModified = freshness.iso;
  }

  if (data.lat !== undefined && data.lon !== undefined) {
    webPage.about = {
      '@type': 'Place',
      name: data.name,
      geo: {
        '@type': 'GeoCoordinates',
        latitude: data.lat,
        longitude: data.lon,
      },
    };
  }

  jsonLd.push(webPage);

  if (data.breadcrumbs && data.breadcrumbs.length > 0) {
    jsonLd.push({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Ana Sayfa', item: `${SITE_ORIGIN}/` },
        ...data.breadcrumbs.map((crumb, i) => ({
          '@type': 'ListItem',
          position: i + 2,
          name: crumb.name,
          item: crumb.url,
        })),
      ],
    });
  }

  if (type === 'home') {
    // No potentialAction/SearchAction: search is client-side only and the
    // site has no search results URL that a SearchAction could target.
    jsonLd.push({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Yarın Hava',
      url: `${SITE_ORIGIN}/`,
      inLanguage: 'tr-TR',
      publisher: ORGANIZATION,
    });
    jsonLd.push({ '@context': 'https://schema.org', ...ORGANIZATION });
  }

  return jsonLd.map((item) => JSON.stringify(item)).join('\n');
}

export function generateLegalPageStructuredData(
  pageTitle: string,
  pageDescription: string,
  canonical: string,
): string {
  const items = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: pageTitle,
      description: pageDescription,
      url: canonical,
      inLanguage: 'tr-TR',
      publisher: ORGANIZATION,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Ana Sayfa', item: `${SITE_ORIGIN}/` },
        { '@type': 'ListItem', position: 2, name: pageTitle, item: canonical },
      ],
    },
  ];
  return items.map((i) => JSON.stringify(i)).join('\n');
}
