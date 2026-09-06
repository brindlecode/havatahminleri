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

export interface SEOData {
  title: string;
  description: string;
  canonical: string;
  /** H1 shown on the page. Always agrees with the title's intent. */
  heading: string;
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
  /** How the place is referred to in prose and headings. */
  short: string;
  /** Disambiguated name for titles and descriptions. */
  qualified: string;
  isDistrict: boolean;
}

/**
 * 51 of the 969 districts are literally named "Merkez" (the provincial
 * centre). Rendering "Merkez Hava Durumu" as an H1 on 51 x 7 = 357 pages is
 * both meaningless to a reader and a duplicate-title signal, so those get the
 * province prefixed. 24 further district names are shared by more than one
 * province, which is why titles always carry the province too.
 */
export function getLocationNames(loc: LocationRef): LocationNames {
  if (!loc.districtName) {
    return { short: loc.provinceName, qualified: loc.provinceName, isDistrict: false };
  }
  if (loc.districtName === 'Merkez') {
    const name = `${loc.provinceName} Merkez`;
    return { short: name, qualified: name, isDistrict: true };
  }
  return {
    short: loc.districtName,
    qualified: `${loc.districtName}, ${loc.provinceName}`,
    isDistrict: true,
  };
}

function clampDescription(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= 160) return collapsed;
  const cut = collapsed.slice(0, 157);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 120 ? lastSpace : 157).trimEnd()}...`;
}

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
 * The base URL previously carried "15 Günlük Tahmin" in its title while a
 * dedicated /15-gunluk/ page existed, so the two competed for the same
 * "<il> hava durumu 15 günlük" queries. It no longer does.
 */
export function getPeriodSEO(
  loc: LocationRef,
  periodId: PeriodId,
  weather?: { temperature: number; weatherCode: number; maxTemp?: number; minTemp?: number },
): SEOData {
  const names = getLocationNames(loc);
  const canonical = getCanonicalForPeriod(loc.provinceSlug, periodId, loc.districtSlug);
  const locative = getCityLocative(names.short);

  const cond = weather ? getWeatherDescription(weather.weatherCode).toLowerCase() : null;
  const nowTemp = weather ? `${Math.round(weather.temperature)}°C` : null;
  const range =
    weather?.maxTemp !== undefined && weather?.minTemp !== undefined
      ? `${Math.round(weather.minTemp)}°C - ${Math.round(weather.maxTemp)}°C`
      : null;

  switch (periodId) {
    case 'bugun':
      return {
        title: `${names.qualified} Bugün Hava Durumu - Saatlik Tahmin | Yarın Hava`,
        description: clampDescription(
          `${locative} bugün hava durumu${cond ? `: şu an ${nowTemp}, ${cond}` : ''}. ` +
            `${range ? `Gün içi ${range} aralığında. ` : ''}Saat saat sıcaklık, yağış olasılığı, rüzgar ve gün doğumu-batımı bilgileri.`,
        ),
        canonical,
        heading: `${names.short} Bugün Hava Durumu`,
      };

    case 'yarin':
      return {
        title: `${names.qualified} Yarın Hava Durumu - Saatlik Tahmin | Yarın Hava`,
        description: clampDescription(
          `${locative} yarın hava nasıl olacak? Yarının en yüksek ve en düşük sıcaklığı, saatlik tahmin, ` +
            `yağış olasılığı ve bugüne göre sıcaklık farkı bu sayfada.`,
        ),
        canonical,
        heading: `${names.short} Yarın Hava Durumu`,
      };

    case '7gun':
      return {
        title: `${names.qualified} 7 Günlük Hava Durumu Tahmini | Yarın Hava`,
        description: clampDescription(
          `${names.qualified} 7 günlük hava durumu tahmini. Haftalık sıcaklık eğilimi, en sıcak ve en serin günler, ` +
            `yağışlı gün sayısı ve hafta sonu karşılaştırması.`,
        ),
        canonical,
        heading: `${names.short} 7 Günlük Hava Durumu`,
      };

    case '10gun':
      return {
        title: `${names.qualified} 10 Günlük Hava Durumu Tahmini | Yarın Hava`,
        description: clampDescription(
          `${names.qualified} 10 günlük hava durumu tahmini. İlk 5 gün ile sonraki 5 günün karşılaştırması, ` +
            `sıcaklık eğilimi ve yağış dağılımı ile günlük tablo.`,
        ),
        canonical,
        heading: `${names.short} 10 Günlük Hava Durumu`,
      };

    case '15gun':
      return {
        title: `${names.qualified} 15 Günlük Hava Durumu Tahmini | Yarın Hava`,
        description: clampDescription(
          `${names.qualified} 15 günlük hava durumu. 15 günün tamamı için günlük en yüksek-en düşük sıcaklık, ` +
            `yağışlı gün sayısı, en sıcak ve en serin dönemler ve uzun vadeli eğilim.`,
        ),
        canonical,
        heading: `${names.short} 15 Günlük Hava Durumu`,
      };

    case 'saatlik':
      return {
        title: `${names.qualified} Saatlik Hava Durumu - 48 Saat | Yarın Hava`,
        description: clampDescription(
          `${locative} saatlik hava durumu. Önümüzdeki 48 saat için saat saat sıcaklık, yağış olasılığı, ` +
            `rüzgar hızı ve gece-gündüz geçişleri.`,
        ),
        canonical,
        heading: `${names.short} Saatlik Hava Durumu`,
      };

    case 'base':
    default:
      return {
        title: `${names.qualified} Hava Durumu: Yarın ve Saatlik Tahmin | Yarın Hava`,
        description: clampDescription(
          `${locative} hava durumu${cond ? `: şu an ${nowTemp}, ${cond}` : ''}. ` +
            `Yarının saatlik tahmini, en yüksek ve en düşük sıcaklık, yağış olasılığı ve rüzgar bilgileri.`,
        ),
        canonical,
        heading: `${names.short} Hava Durumu`,
      };
  }
}

export function getHomeSEO(): SEOData {
  return {
    title: 'Yarın Hava - Türkiye Hava Durumu ve Yarınki Tahmin',
    description:
      'Türkiye hava durumu: 81 il ve 969 ilçe için yarınki ve saatlik tahmin. Bugün, 7, 10 ve 15 günlük ' +
      'sıcaklık, yağış, rüzgar ve nem bilgileri günde iki kez güncellenir.',
    canonical: `${SITE_ORIGIN}/`,
    heading: 'Türkiye Hava Durumu',
  };
}

// --- structured data ---------------------------------------------------------

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

  if (regionName) crumbs.push({ name: regionName, url: `${SITE_ORIGIN}/` });

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
    publisher: {
      '@type': 'Organization',
      name: 'Yarın Hava',
      url: `${SITE_ORIGIN}/`,
    },
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
    jsonLd.push({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Yarın Hava',
      url: `${SITE_ORIGIN}/`,
      inLanguage: 'tr-TR',
    });
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
      publisher: {
        '@type': 'Organization',
        name: 'Yarın Hava',
        url: `${SITE_ORIGIN}/`,
      },
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
