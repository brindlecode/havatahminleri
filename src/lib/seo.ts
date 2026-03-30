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
    title: `${name} Hava Durumu - 15 Günlük Tahmin | Yarın Hava`,
    description,
    canonical: `https://yarinhava.com/${slug}-hava-durumu`,
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
    title: `${districtName} (${provinceName}) Hava Durumu | Yarın Hava`,
    description,
    canonical: `https://yarinhava.com/${provinceSlug}/${districtSlug}-hava-durumu`,
  };
}

export function getHomeSEO(): SEOData {
  return {
    title: 'Yarın Hava - Türkiye Hava Durumu ve 15 Günlük Tahmin',
    description:
      'Türkiye geneli hava durumu ve 15 günlük hava tahmini. 81 il ve tüm ilçeler için saatlik ve günlük detaylı hava tahminleri, sıcaklık, yağış ve rüzgar bilgileri.',
    canonical: 'https://yarinhava.com',
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
      name: 'Yarın Hava',
      url: 'https://yarinhava.com',
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
      name: 'Yarın Hava',
      url: 'https://yarinhava.com',
      potentialAction: {
        '@type': 'SearchAction',
        target: 'https://yarinhava.com/?q={search_term_string}',
        'query-input': 'required name=search_term_string',
      },
    });
  }

  return jsonLd.map((item) => JSON.stringify(item)).join('\n');
}

export interface FAQItem {
  question: string;
  answer: string;
}

export function generateFAQSchema(faqs: FAQItem[]): string {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  };
  return JSON.stringify(schema);
}

export function buildWeatherFAQs(
  cityName: string,
  todayDesc: string,
  todayMax: number,
  todayMin: number,
  tomorrowDesc: string,
  tomorrowMax: number,
  tomorrowMin: number,
  precipProb: number,
  weekMinTemp: number,
  weekMaxTemp: number,
): FAQItem[] {
  return [
    {
      question: `${cityName} bugün hava nasıl?`,
      answer: `${cityName}'de bugün hava ${todayDesc.toLowerCase()}. En yüksek sıcaklık ${todayMax}°C, en düşük sıcaklık ${todayMin}°C olarak tahmin edilmektedir.`,
    },
    {
      question: `${cityName}'de yarın hava nasıl olacak?`,
      answer: `${cityName} yarınki hava tahminine göre ${tomorrowDesc.toLowerCase()} beklenmektedir. Sıcaklık ${tomorrowMax}°C ile ${tomorrowMin}°C arasında olacaktır.${precipProb > 30 ? ` Yağış olasılığı %${precipProb} seviyesindedir.` : ''}`,
    },
    {
      question: `${cityName} 15 günlük hava durumu tahmini nedir?`,
      answer: `${cityName} için önümüzdeki 15 gün boyunca sıcaklıklar ${weekMinTemp}°C ile ${weekMaxTemp}°C arasında seyredecektir. Detaylı saatlik ve günlük tahminler için yarinhava.com'u ziyaret edebilirsiniz.`,
    },
    {
      question: `${cityName}'de yağmur yağacak mı?`,
      answer: precipProb > 30
        ? `Evet, ${cityName}'de yakın dönemde yağış olasılığı %${precipProb} seviyesindedir. Dışarı çıkarken şemsiye almanızı öneririz.`
        : `${cityName}'de yakın dönemde belirgin bir yağış beklenmemektedir. Ancak güncel tahminleri takip etmenizi öneririz.`,
    },
  ];
}
