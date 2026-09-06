import type { WeatherData } from './weather.ts';
import { getWeatherDescription } from './weatherCodes.ts';
import { getCityLocative } from './utils.ts';
import { PERIOD_DEFS, type PeriodId } from './periods.ts';

/**
 * Period-specific, data-driven page content.
 *
 * Before this module every period page rendered the same four
 * WeatherSummary sections ("... Hava Durumu", "... Yarın Hava Nasıl
 * Olacak?", "Haftalık Değerlendirme", "Hafta Sonu"), which made
 * /bugun/, /yarin/, /7-gunluk/, /10-gunluk/, /15-gunluk/ and /saatlik/
 * 92-98% textually identical to each other.
 *
 * Every sentence produced here is computed from the forecast arrays for the
 * range the page actually covers. Nothing is filler prose: if the data does
 * not support a statement, the block is omitted.
 */

export interface SummaryStat {
  label: string;
  value: string;
}

export interface SummaryBlock {
  heading: string;
  paragraph: string;
  stats?: SummaryStat[];
}

export interface FAQItem {
  question: string;
  answer: string;
}

// --- small helpers -----------------------------------------------------------

const TR_WEEKDAY = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const TR_MONTH = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

/**
 * Daily entries are plain "YYYY-MM-DD" strings in Europe/Istanbul. Anchoring
 * at midday UTC keeps the weekday correct whatever timezone the build runs in.
 */
function parseDay(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}

export function weekdayName(date: string): string {
  return TR_WEEKDAY[parseDay(date).getUTCDay()];
}

export function dayMonth(date: string): string {
  const d = parseDay(date);
  return `${d.getUTCDate()} ${TR_MONTH[d.getUTCMonth()]}`;
}

export function isWeekend(date: string): boolean {
  const d = parseDay(date).getUTCDay();
  return d === 0 || d === 6;
}

/** Hourly entries look like "2026-09-06T14:00" (already Istanbul local time). */
function hourOf(time: string): number {
  return Number(time.slice(11, 13));
}

function round(n: number): number {
  return Math.round(n);
}

function avg(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function fmtSigned(n: number): string {
  const r = round(n);
  if (r === 0) return 'aynı';
  return r > 0 ? `${r}°C daha sıcak` : `${Math.abs(r)}°C daha serin`;
}

/** Merge consecutive hours above the precipitation-probability threshold. */
function rainWindows(
  weather: WeatherData,
  start: number,
  end: number,
  threshold = 50,
): { from: number; to: number; peak: number }[] {
  const windows: { from: number; to: number; peak: number }[] = [];
  let open: { from: number; to: number; peak: number } | null = null;

  for (let i = start; i < end && i < weather.hourly.time.length; i++) {
    const prob = weather.hourly.precipitationProbability[i] ?? 0;
    const hour = hourOf(weather.hourly.time[i]);
    if (prob >= threshold) {
      if (open && hour === (open.to + 1) % 24) {
        open.to = hour;
        open.peak = Math.max(open.peak, prob);
      } else {
        if (open) windows.push(open);
        open = { from: hour, to: hour, peak: prob };
      }
    } else if (open) {
      windows.push(open);
      open = null;
    }
  }
  if (open) windows.push(open);
  return windows;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function describeWindows(windows: { from: number; to: number; peak: number }[]): string {
  return windows
    .slice(0, 3)
    .map((w) =>
      w.from === w.to
        ? `${pad2(w.from)}:00 civarı`
        : `${pad2(w.from)}:00-${pad2(w.to)}:59 arası`,
    )
    .join(', ');
}

/** Average temperature across a named part of the day. */
function partOfDay(
  weather: WeatherData,
  start: number,
  end: number,
  fromHour: number,
  toHour: number,
): number | null {
  const temps: number[] = [];
  for (let i = start; i < end && i < weather.hourly.time.length; i++) {
    const h = hourOf(weather.hourly.time[i]);
    if (h >= fromHour && h <= toHour) temps.push(weather.hourly.temperature[i]);
  }
  return temps.length ? avg(temps) : null;
}

function timeOnly(iso: string | undefined): string | null {
  if (!iso) return null;
  const m = iso.match(/T(\d{2}:\d{2})/);
  return m ? m[1] : null;
}

// --- day-range statistics ----------------------------------------------------

export interface RangeStats {
  count: number;
  maxTemp: number;
  minTemp: number;
  warmest: { date: string; temp: number };
  coldest: { date: string; temp: number };
  rainyDays: string[];
  totalPrecip: number;
  /** Mean of the daily highs. */
  meanHigh: number;
  /** Population standard deviation of the daily highs. */
  highVariability: number;
}

export function rangeStats(weather: WeatherData, start: number, count: number): RangeStats {
  const { daily } = weather;
  const end = Math.min(start + count, daily.time.length);
  const highs: number[] = [];
  const rainyDays: string[] = [];
  let totalPrecip = 0;
  let warmest = { date: daily.time[start], temp: -Infinity };
  let coldest = { date: daily.time[start], temp: Infinity };
  let minTemp = Infinity;
  let maxTemp = -Infinity;

  for (let i = start; i < end; i++) {
    const hi = daily.temperatureMax[i];
    const lo = daily.temperatureMin[i];
    highs.push(hi);
    maxTemp = Math.max(maxTemp, hi);
    minTemp = Math.min(minTemp, lo);
    if (hi > warmest.temp) warmest = { date: daily.time[i], temp: hi };
    if (lo < coldest.temp) coldest = { date: daily.time[i], temp: lo };
    const precip = daily.precipitationSum[i] ?? 0;
    totalPrecip += precip;
    // A "rainy day" needs either measurable accumulation or a high enough
    // probability to plan around. Probability alone at 50% is common in
    // long-range output and would mark almost every day rainy.
    if (precip >= 0.5 || (daily.precipitationProbabilityMax[i] ?? 0) >= 60) {
      rainyDays.push(daily.time[i]);
    }
  }

  const meanHigh = avg(highs);
  const variance = avg(highs.map((h) => (h - meanHigh) ** 2));

  return {
    count: end - start,
    maxTemp: round(maxTemp),
    minTemp: round(minTemp),
    warmest: { date: warmest.date, temp: round(warmest.temp) },
    coldest: { date: coldest.date, temp: round(coldest.temp) },
    rainyDays,
    totalPrecip: Math.round(totalPrecip * 10) / 10,
    meanHigh: Math.round(meanHigh * 10) / 10,
    highVariability: Math.round(Math.sqrt(variance) * 10) / 10,
  };
}

function rainSentence(stats: RangeStats): string {
  if (!stats.rainyDays.length) {
    return `Önümüzdeki ${stats.count} gün boyunca kayda değer bir yağış öngörülmüyor.`;
  }
  const names = stats.rainyDays.slice(0, 5).map((d) => `${weekdayName(d)} (${dayMonth(d)})`);
  const more =
    stats.rainyDays.length > names.length ? ` ve ${stats.rainyDays.length - names.length} gün daha` : '';
  // Only claim an accumulation when the model actually forecasts one; a day
  // can carry a high probability with a negligible expected total.
  const amount =
    stats.totalPrecip > 0
      ? ` Bu günlerde toplam ${stats.totalPrecip} mm yağış öngörülüyor.`
      : ' Yağış olasılığı yüksek olsa da beklenen toplam yağış miktarı ölçülebilir seviyenin altında.';
  return `${stats.count} günün ${stats.rainyDays.length} gününde yağış bekleniyor: ${names.join(', ')}${more}.${amount}`;
}

// --- per-period summaries ----------------------------------------------------

function todayBlocks(weather: WeatherData, city: string): SummaryBlock[] {
  const { daily, current } = weather;
  const loc = getCityLocative(city);
  const hi = round(daily.temperatureMax[0]);
  const lo = round(daily.temperatureMin[0]);
  const desc = getWeatherDescription(daily.weatherCode[0]).toLowerCase();
  const sunrise = timeOnly(daily.sunrise[0]);
  const sunset = timeOnly(daily.sunset[0]);
  const windows = rainWindows(weather, 0, 24);

  const morning = partOfDay(weather, 0, 24, 6, 11);
  const afternoon = partOfDay(weather, 0, 24, 12, 17);
  const evening = partOfDay(weather, 0, 24, 18, 23);

  let windPeakHour = 0;
  let windPeak = -1;
  for (let i = 0; i < Math.min(24, weather.hourly.time.length); i++) {
    if (weather.hourly.windSpeed[i] > windPeak) {
      windPeak = weather.hourly.windSpeed[i];
      windPeakHour = hourOf(weather.hourly.time[i]);
    }
  }

  const stats: SummaryStat[] = [
    { label: 'En yüksek', value: `${hi}°C` },
    { label: 'En düşük', value: `${lo}°C` },
    { label: 'Hissedilen', value: `${round(current.apparentTemperature)}°C` },
  ];
  if (sunrise) stats.push({ label: 'Gün doğumu', value: sunrise });
  if (sunset) stats.push({ label: 'Gün batımı', value: sunset });

  const blocks: SummaryBlock[] = [
    {
      heading: `${loc} bugün hava nasıl?`,
      paragraph:
        `${dayMonth(daily.time[0])} ${weekdayName(daily.time[0])} günü ${loc} hava ${desc}. ` +
        `Gün içinde sıcaklık ${lo}°C ile ${hi}°C arasında seyredecek; şu anda ölçülen ${round(current.temperature)}°C, ` +
        `hissedilen sıcaklık ${round(current.apparentTemperature)}°C.` +
        (sunrise && sunset ? ` Güneş ${sunrise}'da doğuyor, ${sunset}'da batıyor.` : ''),
      stats,
    },
    {
      heading: 'Gün içi sıcaklık seyri',
      paragraph:
        [
          morning !== null ? `Sabah saatleri (06-11) ortalama ${round(morning)}°C` : null,
          afternoon !== null ? `öğleden sonra (12-17) ${round(afternoon)}°C` : null,
          evening !== null ? `akşam (18-23) ${round(evening)}°C` : null,
        ]
          .filter(Boolean)
          .join(', ') +
        `. Rüzgar en yüksek hızına ${pad2(windPeakHour)}:00 civarında ulaşıyor (${round(windPeak)} km/s).`,
    },
  ];

  blocks.push({
    heading: 'Bugün yağış var mı?',
    paragraph: windows.length
      ? `Bugün ${describeWindows(windows)} yağış olasılığı yükseliyor; en yüksek olasılık %${Math.max(...windows.map((w) => w.peak))}. Bu saatlerde dışarıda olacaksanız yanınıza şemsiye alın.`
      : `Bugün için saatlik tahminlerde %50'yi aşan bir yağış olasılığı görünmüyor. Gün boyunca en yüksek yağış olasılığı %${round(Math.max(0, ...weather.hourly.precipitationProbability.slice(0, 24)))}.`,
  });

  return blocks;
}

function tomorrowBlocks(weather: WeatherData, city: string): SummaryBlock[] {
  const { daily } = weather;
  const loc = getCityLocative(city);
  const hi = round(daily.temperatureMax[1]);
  const lo = round(daily.temperatureMin[1]);
  const desc = getWeatherDescription(daily.weatherCode[1]).toLowerCase();
  const delta = daily.temperatureMax[1] - daily.temperatureMax[0];
  const sunrise = timeOnly(daily.sunrise[1]);
  const sunset = timeOnly(daily.sunset[1]);
  const windows = rainWindows(weather, 24, 48);

  const morning = partOfDay(weather, 24, 48, 6, 11);
  const afternoon = partOfDay(weather, 24, 48, 12, 17);
  const evening = partOfDay(weather, 24, 48, 18, 23);

  const stats: SummaryStat[] = [
    { label: 'En yüksek', value: `${hi}°C` },
    { label: 'En düşük', value: `${lo}°C` },
    { label: 'Bugüne göre', value: fmtSigned(delta) },
    { label: 'Yağış olasılığı', value: `%${round(daily.precipitationProbabilityMax[1] ?? 0)}` },
  ];
  if (sunrise) stats.push({ label: 'Gün doğumu', value: sunrise });
  if (sunset) stats.push({ label: 'Gün batımı', value: sunset });

  const blocks: SummaryBlock[] = [
    {
      heading: `${loc} yarın hava nasıl olacak?`,
      paragraph:
        `${dayMonth(daily.time[1])} ${weekdayName(daily.time[1])} günü ${loc} hava ${desc} olması bekleniyor. ` +
        `Sıcaklık ${lo}°C ile ${hi}°C arasında olacak; bu, bugünün en yükseğine göre ${fmtSigned(delta)} demek.` +
        (sunrise && sunset ? ` Güneş ${sunrise}'da doğacak, ${sunset}'da batacak.` : ''),
      stats,
    },
    {
      heading: 'Yarın sabah, öğle ve akşam',
      paragraph:
        [
          morning !== null ? `Sabah (06-11) ortalama ${round(morning)}°C` : null,
          afternoon !== null ? `öğleden sonra (12-17) ${round(afternoon)}°C` : null,
          evening !== null ? `akşam (18-23) ${round(evening)}°C` : null,
        ]
          .filter(Boolean)
          .join(', ') + ' bekleniyor. Gün içindeki saatlik değerleri yukarıdaki tablodan takip edebilirsiniz.',
    },
    {
      heading: 'Yarın yağmur yağacak mı?',
      paragraph: windows.length
        ? `Yarın ${describeWindows(windows)} yağış olasılığı %50'nin üzerine çıkıyor; gün içindeki en yüksek olasılık %${Math.max(...windows.map((w) => w.peak))}.`
        : `Yarın için saatlik tahminlerde %50'yi aşan bir yağış olasılığı bulunmuyor. Günün en yüksek yağış olasılığı %${round(daily.precipitationProbabilityMax[1] ?? 0)}.`,
    },
  ];

  return blocks;
}

function weekBlocks(weather: WeatherData, city: string): SummaryBlock[] {
  const stats = rangeStats(weather, 0, 7);
  const { daily } = weather;
  const loc = getCityLocative(city);

  const weekendIdx: number[] = [];
  for (let i = 0; i < Math.min(7, daily.time.length); i++) {
    if (isWeekend(daily.time[i])) weekendIdx.push(i);
  }

  const blocks: SummaryBlock[] = [
    {
      heading: `${loc} 7 günlük hava durumu özeti`,
      paragraph:
        `Önümüzdeki 7 gün boyunca sıcaklıklar ${stats.minTemp}°C ile ${stats.maxTemp}°C arasında seyredecek. ` +
        `En sıcak gün ${weekdayName(stats.warmest.date)} (${dayMonth(stats.warmest.date)}) ${stats.warmest.temp}°C ile, ` +
        `en serin gece ise ${weekdayName(stats.coldest.date)} (${dayMonth(stats.coldest.date)}) ${stats.coldest.temp}°C ile öne çıkıyor.`,
      stats: [
        { label: 'En yüksek', value: `${stats.maxTemp}°C` },
        { label: 'En düşük', value: `${stats.minTemp}°C` },
        { label: 'Ortalama en yüksek', value: `${stats.meanHigh}°C` },
        { label: 'Yağışlı gün', value: `${stats.rainyDays.length} / 7` },
      ],
    },
    {
      heading: 'Hafta boyunca yağış dağılımı',
      paragraph: rainSentence(stats),
    },
  ];

  if (weekendIdx.length) {
    const parts = weekendIdx.map(
      (i) =>
        `${weekdayName(daily.time[i])} ${round(daily.temperatureMax[i])}°/${round(daily.temperatureMin[i])}° (${getWeatherDescription(daily.weatherCode[i]).toLowerCase()})`,
    );
    const weekdayHighs = [];
    for (let i = 0; i < Math.min(7, daily.time.length); i++) {
      if (!isWeekend(daily.time[i])) weekdayHighs.push(daily.temperatureMax[i]);
    }
    const weekendHighs = weekendIdx.map((i) => daily.temperatureMax[i]);
    const diff = avg(weekendHighs) - avg(weekdayHighs);
    blocks.push({
      heading: 'Hafta sonu hafta içine göre nasıl?',
      paragraph:
        `${parts.join(', ')}. ` +
        (weekdayHighs.length
          ? `Hafta sonu en yüksek sıcaklıkları, hafta içi ortalamasına göre ${fmtSigned(diff)}.`
          : ''),
    });
  }

  return blocks;
}

function tenDayBlocks(weather: WeatherData, city: string): SummaryBlock[] {
  const stats = rangeStats(weather, 0, 10);
  const first = rangeStats(weather, 0, 5);
  const second = rangeStats(weather, 5, 5);
  const loc = getCityLocative(city);
  const delta = second.meanHigh - first.meanHigh;
  const direction =
    Math.abs(delta) < 1.5 ? 'belirgin bir değişim göstermiyor' : delta > 0 ? 'yükseliş eğiliminde' : 'düşüş eğiliminde';

  return [
    {
      heading: `${loc} 10 günlük hava durumu eğilimi`,
      paragraph:
        `Önümüzdeki 10 gün için sıcaklıklar ${stats.minTemp}°C ile ${stats.maxTemp}°C aralığında. ` +
        `İlk 5 günün ortalama en yüksek sıcaklığı ${first.meanHigh}°C, sonraki 5 günün ${second.meanHigh}°C; ` +
        `yani hava ${direction}.`,
      stats: [
        { label: 'İlk 5 gün ort.', value: `${first.meanHigh}°C` },
        { label: 'Son 5 gün ort.', value: `${second.meanHigh}°C` },
        { label: 'Fark', value: fmtSigned(delta) },
        { label: 'Yağışlı gün', value: `${stats.rainyDays.length} / 10` },
      ],
    },
    {
      heading: '10 gün boyunca yağış dağılımı',
      paragraph:
        rainSentence(stats) +
        (stats.totalPrecip > 0
          ? ` Bunun ${first.totalPrecip} mm'lik kısmı ilk 5 güne, ${second.totalPrecip} mm'lik kısmı sonraki 5 güne dağılıyor.`
          : ''),
    },
  ];
}

function fifteenDayBlocks(weather: WeatherData, city: string): SummaryBlock[] {
  const days = PERIOD_DEFS['15gun'].dayCount;
  const stats = rangeStats(weather, 0, days);
  const loc = getCityLocative(city);
  const { daily } = weather;

  // Warmest / coldest 3-day window across the range.
  let bestStart = 0;
  let bestAvg = -Infinity;
  let worstStart = 0;
  let worstAvg = Infinity;
  for (let i = 0; i + 3 <= Math.min(days, daily.time.length); i++) {
    const a = avg(daily.temperatureMax.slice(i, i + 3));
    if (a > bestAvg) { bestAvg = a; bestStart = i; }
    if (a < worstAvg) { worstAvg = a; worstStart = i; }
  }

  const variability =
    stats.highVariability < 2
      ? 'oldukça istikrarlı'
      : stats.highVariability < 4
        ? 'ılımlı dalgalanmalar gösteren'
        : 'belirgin şekilde değişken';

  const lastDate = daily.time[Math.min(days, daily.time.length) - 1];

  return [
    {
      heading: `${loc} 15 günlük hava durumu değerlendirmesi`,
      paragraph:
        `${dayMonth(daily.time[0])} - ${dayMonth(lastDate)} arasındaki ${stats.count} gün için sıcaklıklar ` +
        `${stats.minTemp}°C ile ${stats.maxTemp}°C arasında. Günlük en yüksek sıcaklıkların ortalaması ${stats.meanHigh}°C ve ` +
        `standart sapması ${stats.highVariability}°C; bu da ${variability} bir dönem anlamına geliyor.`,
      stats: [
        { label: 'Gün sayısı', value: `${stats.count}` },
        { label: 'En yüksek', value: `${stats.maxTemp}°C` },
        { label: 'En düşük', value: `${stats.minTemp}°C` },
        { label: 'Ortalama en yüksek', value: `${stats.meanHigh}°C` },
        { label: 'Yağışlı gün', value: `${stats.rainyDays.length} / ${stats.count}` },
      ],
    },
    {
      heading: 'En sıcak ve en serin dönemler',
      paragraph:
        `En sıcak üç günlük dönem ${dayMonth(daily.time[bestStart])} - ${dayMonth(daily.time[bestStart + 2])} arasında, ` +
        `ortalama ${round(bestAvg)}°C en yüksek sıcaklıkla. En serin dönem ise ` +
        `${dayMonth(daily.time[worstStart])} - ${dayMonth(daily.time[worstStart + 2])} arasında, ortalama ${round(worstAvg)}°C.`,
    },
    {
      heading: '15 günlük yağış görünümü',
      paragraph: rainSentence(stats),
    },
    {
      heading: 'Uzun vadeli tahminler ne kadar güvenilir?',
      paragraph:
        'Meteorolojik modellerin isabet oranı gün sayısı arttıkça düşer. İlk 3-5 günün tahminleri genellikle yüksek ' +
        'doğrulukta olurken, 8. günden sonrası bir kesin tahminden çok genel bir eğilim göstergesi olarak okunmalıdır. ' +
        'Bu sayfa günde iki kez güncellenir; planlarınızı yaparken tarihe yaklaştıkça tahmini yeniden kontrol edin.',
    },
  ];
}

function hourlyBlocks(weather: WeatherData, city: string): SummaryBlock[] {
  const loc = getCityLocative(city);
  const hours = Math.min(48, weather.hourly.time.length);
  const temps = weather.hourly.temperature.slice(0, hours);
  const windows = rainWindows(weather, 0, hours);

  let maxI = 0;
  let minI = 0;
  for (let i = 1; i < hours; i++) {
    if (temps[i] > temps[maxI]) maxI = i;
    if (temps[i] < temps[minI]) minI = i;
  }

  let windPeakI = 0;
  for (let i = 1; i < hours; i++) {
    if (weather.hourly.windSpeed[i] > weather.hourly.windSpeed[windPeakI]) windPeakI = i;
  }

  const rainyHours = weather.hourly.precipitationProbability
    .slice(0, hours)
    .filter((p) => (p ?? 0) >= 50).length;

  const sunrise = timeOnly(weather.daily.sunrise[0]);
  const sunset = timeOnly(weather.daily.sunset[0]);

  return [
    {
      heading: `${loc} önümüzdeki 48 saat`,
      paragraph:
        `Saatlik tahmin önümüzdeki ${hours} saati kapsıyor. Bu süre içinde en yüksek sıcaklık ` +
        `${dayMonth(weather.hourly.time[maxI].slice(0, 10))} ${pad2(hourOf(weather.hourly.time[maxI]))}:00'da ${round(temps[maxI])}°C, ` +
        `en düşük sıcaklık ${dayMonth(weather.hourly.time[minI].slice(0, 10))} ${pad2(hourOf(weather.hourly.time[minI]))}:00'da ${round(temps[minI])}°C olarak bekleniyor.`,
      stats: [
        { label: 'Kapsam', value: `${hours} saat` },
        { label: 'En yüksek', value: `${round(temps[maxI])}°C` },
        { label: 'En düşük', value: `${round(temps[minI])}°C` },
        { label: 'Yağışlı saat', value: `${rainyHours}` },
      ],
    },
    {
      heading: 'Yağışın beklendiği saatler',
      paragraph: windows.length
        ? `48 saatin ${rainyHours} saatinde yağış olasılığı %50'nin üzerinde. Öne çıkan aralıklar: ${describeWindows(windows)}.`
        : '48 saatlik tahminde yağış olasılığının %50\'yi aştığı bir saat bulunmuyor.',
    },
    {
      heading: 'Rüzgar ve gece-gündüz geçişleri',
      paragraph:
        `Rüzgar en yüksek hızına ${pad2(hourOf(weather.hourly.time[windPeakI]))}:00'da ` +
        `${round(weather.hourly.windSpeed[windPeakI])} km/s ile ulaşıyor.` +
        (sunrise && sunset
          ? ` Bugün güneş ${sunrise}'da doğdu ve ${sunset}'da batıyor; gece saatlerinde sıcaklık düşüşü tabloda takip edilebilir.`
          : ''),
    },
  ];
}

/**
 * Visible, data-driven content blocks for one period page.
 */
export function getPeriodSummary(
  weather: WeatherData,
  periodId: PeriodId,
  cityName: string,
): SummaryBlock[] {
  switch (periodId) {
    case 'bugun':
      return todayBlocks(weather, cityName);
    case 'base':
    case 'yarin':
      return tomorrowBlocks(weather, cityName);
    case '7gun':
      return weekBlocks(weather, cityName);
    case '10gun':
      return tenDayBlocks(weather, cityName);
    case '15gun':
      return fifteenDayBlocks(weather, cityName);
    case 'saatlik':
      return hourlyBlocks(weather, cityName);
    default:
      return tomorrowBlocks(weather, cityName);
  }
}

/**
 * Visible Q&A matching the page's own intent.
 *
 * These are rendered as plain content, not as FAQPage JSON-LD: since Google's
 * August 2023 change FAQ rich results are limited to authoritative government
 * and health sites, so marking these up would add schema weight with no
 * eligible rich result.
 */
export function getPeriodFAQs(
  weather: WeatherData,
  periodId: PeriodId,
  cityName: string,
): FAQItem[] {
  const loc = getCityLocative(cityName);
  const { daily } = weather;
  const todayHi = round(daily.temperatureMax[0]);
  const todayLo = round(daily.temperatureMin[0]);
  const tomHi = round(daily.temperatureMax[1]);
  const tomLo = round(daily.temperatureMin[1]);

  switch (periodId) {
    case 'bugun': {
      const windows = rainWindows(weather, 0, 24);
      return [
        {
          question: `${loc} bugün en yüksek ve en düşük sıcaklık kaç derece?`,
          answer: `Bugün ${loc} en yüksek sıcaklık ${todayHi}°C, en düşük sıcaklık ${todayLo}°C olarak bekleniyor.`,
        },
        {
          question: `${loc} bugün yağmur yağacak mı?`,
          answer: windows.length
            ? `Evet, bugün ${describeWindows(windows)} yağış olasılığı %50'nin üzerinde.`
            : `Bugün için %50'yi aşan bir yağış olasılığı görünmüyor.`,
        },
        {
          question: `${cityName} bugün ne giyilir?`,
          answer:
            todayHi >= 28
              ? `${todayHi}°C'lik en yüksek sıcaklıkla ince ve açık renkli kıyafetler, güneş koruması uygun olur.`
              : todayHi >= 18
                ? `Gün içi ${todayLo}-${todayHi}°C aralığı için ince bir katman yeterli; sabah ve akşam serinliğine karşı hafif bir üst bulundurun.`
                : `${todayLo}-${todayHi}°C aralığı için kat kat giyinmek ve rüzgar geçirmeyen bir üst tercih etmek uygun olur.`,
        },
      ];
    }
    case '7gun': {
      const s = rangeStats(weather, 0, 7);
      return [
        {
          question: `${cityName} 7 günlük hava durumu nasıl?`,
          answer: `Önümüzdeki 7 gün sıcaklıklar ${s.minTemp}°C ile ${s.maxTemp}°C arasında seyredecek; ${s.rainyDays.length} gün yağış bekleniyor.`,
        },
        {
          question: `${cityName} bu hafta en sıcak gün hangisi?`,
          answer: `${weekdayName(s.warmest.date)} (${dayMonth(s.warmest.date)}) günü ${s.warmest.temp}°C ile haftanın en sıcak günü olarak öne çıkıyor.`,
        },
      ];
    }
    case '10gun': {
      const s = rangeStats(weather, 0, 10);
      return [
        {
          question: `${cityName} 10 günlük hava durumu tahmini nedir?`,
          answer: `10 günlük tahminde sıcaklıklar ${s.minTemp}°C ile ${s.maxTemp}°C arasında; günlük en yüksek sıcaklıkların ortalaması ${s.meanHigh}°C ve ${s.rainyDays.length} gün yağış öngörülüyor.`,
        },
      ];
    }
    case '15gun': {
      const s = rangeStats(weather, 0, PERIOD_DEFS['15gun'].dayCount);
      return [
        {
          question: `${cityName} 15 günlük hava durumu tahmini nedir?`,
          answer: `${cityName} için 15 günlük tahminde sıcaklıklar ${s.minTemp}°C ile ${s.maxTemp}°C arasında seyrediyor. Günlük en yüksek sıcaklıkların ortalaması ${s.meanHigh}°C ve ${s.count} günün ${s.rainyDays.length} gününde yağış bekleniyor.`,
        },
        {
          question: '15 günlük hava tahmini ne kadar doğrudur?',
          answer:
            'İlk 3-5 günlük tahminler yüksek doğruluk taşır. 8. günden sonraki değerler kesin bir tahminden çok genel bir eğilim göstergesidir ve tarihe yaklaştıkça değişebilir.',
        },
        {
          question: `${cityName} 15 gün içinde kaç gün yağış bekleniyor?`,
          answer: `${s.count} günlük tahminde ${s.rainyDays.length} gün yağışlı geçmesi, toplamda ${s.totalPrecip} mm yağış düşmesi bekleniyor.`,
        },
      ];
    }
    case 'saatlik': {
      const hours = Math.min(48, weather.hourly.time.length);
      const rainyHours = weather.hourly.precipitationProbability
        .slice(0, hours)
        .filter((p) => (p ?? 0) >= 50).length;
      return [
        {
          question: `${cityName} saatlik hava durumu kaç saati kapsıyor?`,
          answer: `Bu sayfadaki saatlik tahmin, içinde bulunulan saatten itibaren ${hours} saati kapsar ve günde iki kez güncellenir.`,
        },
        {
          question: `${loc} önümüzdeki 48 saatte kaç saat yağış bekleniyor?`,
          answer: `${hours} saatin ${rainyHours} saatinde yağış olasılığı %50'nin üzerinde görünüyor.`,
        },
      ];
    }
    case 'base':
    case 'yarin':
    default: {
      const windows = rainWindows(weather, 24, 48);
      return [
        {
          question: `${loc} yarın hava nasıl olacak?`,
          answer: `Yarın ${loc} hava ${getWeatherDescription(daily.weatherCode[1]).toLowerCase()} bekleniyor; sıcaklık ${tomLo}°C ile ${tomHi}°C arasında olacak.`,
        },
        {
          question: `${loc} yarın yağmur yağacak mı?`,
          answer: windows.length
            ? `Yarın ${describeWindows(windows)} yağış olasılığı %50'nin üzerine çıkıyor.`
            : `Yarın için %50'yi aşan bir yağış olasılığı bulunmuyor; günün en yüksek olasılığı %${round(daily.precipitationProbabilityMax[1] ?? 0)}.`,
        },
        {
          question: `${cityName} yarın bugüne göre daha mı sıcak olacak?`,
          answer: `Yarının en yüksek sıcaklığı ${tomHi}°C, bugünün en yüksek sıcaklığı ${todayHi}°C. Yarın bugüne göre ${fmtSigned(daily.temperatureMax[1] - daily.temperatureMax[0])} olacak.`,
        },
      ];
    }
  }
}
