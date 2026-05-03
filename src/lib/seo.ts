import { getWeatherDescription } from './weatherCodes';
import { getCityLocative } from './utils';

export interface SEOData {
  title: string;
  description: string;
  canonical: string;
  ogImage?: string;
}

export function getProvinceSEO(name: string, slug: string, temp?: number, weatherCode?: number): SEOData {
  const weatherDesc = weatherCode !== undefined ? getWeatherDescription(weatherCode) : '';
  const tempStr = temp !== undefined ? `${Math.round(temp)}°C` : '';

  let description: string;
  if (tempStr && weatherDesc) {
    description = `${name} hava durumu ve 15 günlük tahmin. Şu an ${tempStr}, ${weatherDesc.toLowerCase()}. Saatlik sıcaklık, yağış olasılığı, rüzgar ve nem bilgileriyle hava nasıl olacak öğrenin.`;
  } else {
    description = `${name} hava durumu ve 15 günlük detaylı tahmin. Saatlik sıcaklık, yağış olasılığı, rüzgar ve nem bilgileriyle hava nasıl olacak öğrenin.`;
  }

  return {
    title: `${name} Hava Durumu - 15 Günlük Tahmin | Yarın Hava`,
    description,
    canonical: `https://yarinhava.com/${slug}-hava-durumu/`,
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

  let description: string;
  if (tempStr && weatherDesc) {
    description = `${districtName} (${provinceName}) hava durumu ve 15 günlük tahmin. Şu an ${tempStr}, ${weatherDesc.toLowerCase()}. Saatlik sıcaklık, yağış olasılığı ve detaylı bilgiler.`;
  } else {
    description = `${districtName} (${provinceName}) hava durumu ve 15 günlük tahmin. Saatlik sıcaklık, yağış olasılığı, rüzgar ve nem bilgileriyle ${districtName} havası.`;
  }

  return {
    title: `${districtName} ${provinceName} Hava Durumu | Yarın Hava`,
    description,
    canonical: `https://yarinhava.com/${provinceSlug}/${districtSlug}-hava-durumu/`,
  };
}

export function getHomeSEO(): SEOData {
  return {
    title: 'Yarın Hava - Türkiye Hava Durumu ve 15 Günlük Tahmin',
    description:
      'Türkiye hava durumu ve 15 günlük detaylı tahmin. 81 il ve tüm ilçeler için saatlik sıcaklık, yağış, rüzgar ve nem bilgileri. Bugün, yarın ve sonraki günler.',
    canonical: 'https://yarinhava.com/',
  };
}

export function generateLegalPageStructuredData(
  pageTitle: string,
  pageDescription: string,
  canonical: string,
): string {
  const today = new Date().toISOString().split('T')[0];
  const items = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: pageTitle,
      description: pageDescription,
      url: canonical,
      inLanguage: 'tr-TR',
      dateModified: today,
      publisher: {
        '@type': 'Organization',
        name: 'Yarın Hava',
        url: 'https://yarinhava.com/',
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Ana Sayfa', item: 'https://yarinhava.com/' },
        { '@type': 'ListItem', position: 2, name: pageTitle, item: canonical },
      ],
    },
  ];
  return items.map((i) => JSON.stringify(i)).join('\n');
}

export interface PeriodMeta {
  titlePrefix: string;
  shortLabel: string;
  description: (city: string) => string;
}

export const PERIOD_META: Record<string, PeriodMeta> = {
  bugun: {
    titlePrefix: 'Bugünkü',
    shortLabel: 'bugünkü',
    description: (city) =>
      `${city} bugünkü hava durumu. Saatlik tahmin, sıcaklık değişimleri, yağış ve rüzgar bilgileri. ${city}'de bugün hava nasıl, ne giyilir öğrenin.`,
  },
  yarin: {
    titlePrefix: 'Yarınki',
    shortLabel: 'yarınki',
    description: (city) =>
      `${city} yarınki hava durumu tahmini. Saatlik sıcaklık değişimleri, yağış olasılığı, rüzgar ve nem bilgileri. Yarın hava nasıl olacak?`,
  },
  saatlik: {
    titlePrefix: 'Saatlik',
    shortLabel: 'saatlik',
    description: (city) =>
      `${city} saatlik hava durumu - 48 saat ileriye dönük tahmin. Sıcaklık, yağış olasılığı, rüzgar ve nem saat saat görüntüleyin.`,
  },
  '7gun': {
    titlePrefix: '7 Günlük',
    shortLabel: '7 günlük',
    description: (city) =>
      `${city} 7 günlük hava durumu tahmini. Haftalık sıcaklık eğilimi, yağışlı günler ve hafta sonu havası. 7 günlük tahmini görün.`,
  },
  '10gun': {
    titlePrefix: '10 Günlük',
    shortLabel: '10 günlük',
    description: (city) =>
      `${city} 10 günlük hava durumu tahmini. Önümüzdeki 10 gün için sıcaklık, yağış olasılığı ve hava değişimleri. ${city} meteorolojik veri.`,
  },
  '15gun': {
    titlePrefix: '15 Günlük',
    shortLabel: '15 günlük',
    description: (city) =>
      `${city} 15 günlük hava durumu tahmini. 16 gün ileriye dönük günlük sıcaklık, yağış ve hava değişimleri. ${city} uzun vadeli hava planı.`,
  },
};

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
    dateModified: new Date().toISOString().split('T')[0],
    publisher: {
      '@type': 'Organization',
      name: 'Yarın Hava',
      url: 'https://yarinhava.com/',
    },
    speakable: {
      '@type': 'SpeakableSpecification',
      cssSelector: ['.weather-card h2', '.weather-card p'],
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
      url: 'https://yarinhava.com/',
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
  const locative = getCityLocative(cityName);
  return [
    {
      question: `${cityName} bugün hava nasıl?`,
      answer: `${locative} bugün hava ${todayDesc.toLowerCase()}. En yüksek sıcaklık ${todayMax}°C, en düşük sıcaklık ${todayMin}°C olarak tahmin edilmektedir.`,
    },
    {
      question: `${locative} yarın hava nasıl olacak?`,
      answer: `${cityName} için yarın hava, tahminlere göre ${tomorrowDesc.toLowerCase()} şeklinde olması beklenmektedir. Sıcaklık ${tomorrowMax}°C ile ${tomorrowMin}°C arasında olacaktır.${precipProb > 30 ? ` Yağış olasılığı %${precipProb} seviyesindedir.` : ''}`,
    },
    {
      question: `${cityName} 15 günlük hava durumu tahmini nedir?`,
      answer: `${cityName} için önümüzdeki 15 gün boyunca sıcaklıklar ${weekMinTemp}°C ile ${weekMaxTemp}°C arasında seyredecektir. Detaylı saatlik ve günlük tahminler için yarinhava.com'u ziyaret edebilirsiniz.`,
    },
    {
      question: `${locative} yağmur yağacak mı?`,
      answer: precipProb > 30
        ? `Evet, ${locative} yakın dönemde yağış olasılığı %${precipProb} seviyesindedir. Dışarı çıkarken şemsiye almanızı öneririz.`
        : `${locative} yakın dönemde belirgin bir yağış beklenmemektedir. Ancak güncel tahminleri takip etmenizi öneririz.`,
    },
  ];
}
