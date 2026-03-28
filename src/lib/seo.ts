import { getWeatherDescription } from './weatherCodes';

export interface SEOData {
  title: string;
  description: string;
  canonical: string;
  ogImage?: string;
}

export function getProvinceSEO(name: string, slug: string, temp?: number, weatherCode?: number): SEOData {
  const weatherDesc = weatherCode !== undefined ? getWeatherDescription(weatherCode) : '';
  const tempStr = temp !== undefined ? `${Math.round(temp)}°C` : '';

  let description = `${name} hava durumu ve 15 günlük hava tahmini.`;
  if (tempStr && weatherDesc) {
    description += ` Bugün ${tempStr}, ${weatherDesc.toLowerCase()}. Saatlik ve günlük detaylı tahminler.`;
  } else {
    description += ` Saatlik ve günlük detaylı hava tahminleri, sıcaklık, yağış ve rüzgar bilgileri.`;
  }

  return {
    title: `${name} Hava Durumu - 15 Günlük Tahmin | Hava Tahminleri`,
    description,
    canonical: `https://havatahminleri.com/${slug}-hava-durumu`,
  };
}

export function getDistrictSEO(
  districtName: string,
  provinceName: string,
  provinceSlug: string,
  districtSlug: string,
  temp?: number,
  weatherCode?: number,
): SEOData {
  const weatherDesc = weatherCode !== undefined ? getWeatherDescription(weatherCode) : '';
  const tempStr = temp !== undefined ? `${Math.round(temp)}°C` : '';

  let description = `${districtName}, ${provinceName} hava durumu ve 15 günlük tahmin.`;
  if (tempStr && weatherDesc) {
    description += ` Bugün ${tempStr}, ${weatherDesc.toLowerCase()}.`;
  }

  return {
    title: `${districtName} (${provinceName}) Hava Durumu | Hava Tahminleri`,
    description,
    canonical: `https://havatahminleri.com/${provinceSlug}/${districtSlug}-hava-durumu`,
  };
}

export function getHomeSEO(): SEOData {
  return {
    title: 'Hava Tahminleri - Türkiye Hava Durumu ve 15 Günlük Tahmin',
    description:
      'Türkiye geneli hava durumu ve 15 günlük hava tahmini. 81 il ve tüm ilçeler için saatlik ve günlük detaylı hava tahminleri, sıcaklık, yağış ve rüzgar bilgileri.',
    canonical: 'https://havatahminleri.com',
  };
}

export function generateStructuredData(
  type: 'home' | 'province' | 'district',
  data: {
    name: string;
    description: string;
    url: string;
    lat?: number;
    lon?: number;
    breadcrumbs?: { name: string; url: string }[];
  },
): string {
  const jsonLd: any[] = [];

  // WebPage
  const webPage: any = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: data.name,
    description: data.description,
    url: data.url,
    inLanguage: 'tr-TR',
    publisher: {
      '@type': 'Organization',
      name: 'Hava Tahminleri',
      url: 'https://havatahminleri.com',
    },
  };

  if (data.lat && data.lon) {
    webPage.mainEntity = {
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

  // BreadcrumbList
  if (data.breadcrumbs && data.breadcrumbs.length > 0) {
    jsonLd.push({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: data.breadcrumbs.map((crumb, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: crumb.name,
        item: crumb.url,
      })),
    });
  }

  // WebSite (only on home)
  if (type === 'home') {
    jsonLd.push({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Hava Tahminleri',
      url: 'https://havatahminleri.com',
      potentialAction: {
        '@type': 'SearchAction',
        target: 'https://havatahminleri.com/?q={search_term_string}',
        'query-input': 'required name=search_term_string',
      },
    });
  }

  return jsonLd.map((item) => JSON.stringify(item)).join('\n');
}
