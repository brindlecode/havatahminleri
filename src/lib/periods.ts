export interface ForecastPeriod {
  id: string;
  label: string;
  slug: string;
}

export const PERIODS: ForecastPeriod[] = [
  { id: 'bugun', label: 'Bugün', slug: 'bugun' },
  { id: 'yarin', label: 'Yarın', slug: 'yarin' },
  { id: '7gun', label: '7 Günlük', slug: '7-gunluk' },
  { id: '10gun', label: '10 Günlük', slug: '10-gunluk' },
  { id: 'saatlik', label: 'Saatlik', slug: 'saatlik' },
];

export function getPeriodLinks(baseUrl: string, activeLabel?: string) {
  return [
    { label: 'Bugün', href: `${baseUrl}/bugun` },
    { label: 'Yarın', href: `${baseUrl}/yarin` },
    { label: '7 Günlük', href: `${baseUrl}/7-gunluk` },
    { label: '10 Günlük', href: `${baseUrl}/10-gunluk` },
    { label: '15 Günlük', href: baseUrl },
    { label: 'Saatlik', href: `${baseUrl}/saatlik` },
  ];
}
