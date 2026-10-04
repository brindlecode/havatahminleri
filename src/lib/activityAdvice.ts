import type { WeatherData } from './weather.ts';
import { getCityLocative } from './utils.ts';
import { weekdayName, dayMonth } from './periodSummary.ts';
import type { PeriodId } from './periods.ts';

/**
 * "Araba yıkanır mı, cam silinir mi, çamaşır kurur mu?" - everyday chores
 * that depend on the weather, answered from the forecast.
 *
 * Every verdict is computed from the daily/hourly arrays: rain on the day
 * itself, rain in the days after (a freshly washed car or window is ruined by
 * the next shower), strong wind (dust), frost and heat. The wording is
 * written to be shared on WhatsApp / social media, so each verdict comes with
 * a short, friendly headline plus a data-backed detail sentence. Headline
 * variants are picked deterministically from the place and date, so the same
 * build always renders the same text but neighbouring pages do not read
 * identically.
 */

export type ActivityId = 'arac' | 'cam' | 'camasir';
export type Verdict = 'good' | 'fair' | 'poor';

export interface ActivityAdvice {
  id: ActivityId;
  emoji: string;
  title: string;
  verdict: Verdict;
  verdictLabel: string;
  /** The day the advice is about, e.g. "Yarın · 5 Ekim Pazar". */
  dayLabel: string;
  headline: string;
  detail: string;
  /** Plain-text message for WhatsApp / social media (without the URL). */
  shareText: string;
}

export interface ActivityAdviceSet {
  heading: string;
  intro: string;
  items: ActivityAdvice[];
  /** Summary of every item for sharing the whole card (without the URL). */
  shareText: string;
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  good: 'Uygun',
  fair: 'Dikkat',
  poor: 'Ertele',
};

const VERDICT_EMOJI: Record<Verdict, string> = { good: '✅', fair: '⚠️', poor: '❌' };
const SCORE: Record<Verdict, number> = { good: 2, fair: 1, poor: 0 };

const ACTIVITIES: { id: ActivityId; emoji: string; title: string }[] = [
  { id: 'arac', emoji: '🚗', title: 'Araç yıkama' },
  { id: 'cam', emoji: '🪟', title: 'Cam silme' },
  { id: 'camasir', emoji: '👕', title: 'Çamaşır kurutma' },
];

/** How far ahead a "better day" is looked for; beyond a week it is a trend. */
const LOOKAHEAD_DAYS = 7;

// --- day context -------------------------------------------------------------

interface Day {
  idx: number;
  date: string;
  code: number;
  hi: number;
  lo: number;
  prob: number;
  sum: number;
  wind: number;
  uv: number;
  /** Average daytime (09-18) relative humidity; only for the 48h window. */
  humidity: number | null;
}

function getDay(weather: WeatherData, idx: number): Day | null {
  const { daily, hourly } = weather;
  if (idx < 0 || idx >= daily.time.length) return null;

  let humidity: number | null = null;
  const values: number[] = [];
  for (let h = idx * 24 + 9; h < idx * 24 + 18 && h < hourly.time.length; h++) {
    if (typeof hourly.humidity[h] === 'number') values.push(hourly.humidity[h]);
  }
  if (values.length) humidity = values.reduce((a, b) => a + b, 0) / values.length;

  return {
    idx,
    date: daily.time[idx],
    code: daily.weatherCode[idx] ?? 0,
    hi: Math.round(daily.temperatureMax[idx]),
    lo: Math.round(daily.temperatureMin[idx]),
    prob: Math.round(daily.precipitationProbabilityMax[idx] ?? 0),
    sum: Math.round((daily.precipitationSum[idx] ?? 0) * 10) / 10,
    wind: Math.round(daily.windSpeedMax[idx] ?? 0),
    uv: daily.uvIndexMax[idx] ?? 0,
    humidity,
  };
}

/** Rain (or snow) that wets a car or a window. */
function isWet(d: Day): boolean {
  return d.prob >= 50 || d.sum >= 1;
}

/** A shower is possible but not likely. */
function isIffy(d: Day): boolean {
  return !isWet(d) && d.prob >= 30;
}

function isSnow(code: number): boolean {
  return (code >= 71 && code <= 77) || code === 85 || code === 86;
}

function trNum(n: number): string {
  return String(n).replace('.', ',');
}

function cap(s: string): string {
  return s.charAt(0).toLocaleUpperCase('tr-TR') + s.slice(1);
}

/** "bugün", "yarın" or "Perşembe (9 Ekim)" - for use inside a sentence. */
function dayRef(d: Day): string {
  if (d.idx === 0) return 'bugün';
  if (d.idx === 1) return 'yarın';
  return `${weekdayName(d.date)} (${dayMonth(d.date)})`;
}

/** "Yarın · 5 Ekim Pazar" - the chip above each item. */
function dayChip(d: Day): string {
  const full = `${dayMonth(d.date)} ${weekdayName(d.date)}`;
  if (d.idx === 0) return `Bugün · ${full}`;
  if (d.idx === 1) return `Yarın · ${full}`;
  return full;
}

function precipText(d: Day): string {
  const kind = isSnow(d.code) ? 'kar' : 'yağış';
  return d.sum > 0 ? `%${d.prob} olasılıkla ${kind} (${trNum(d.sum)} mm)` : `%${d.prob} olasılıkla ${kind}`;
}

/** Small stable string hash, used to pick a headline variant. */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function pick(options: string[], seed: string): string {
  return options[hash(seed) % options.length];
}

// --- per-activity rules -------------------------------------------------------

interface Evaluation {
  verdict: Verdict;
  headlines: string[];
  detail: string;
}

/** Consecutive dry days after `d`, within the data. */
function dryDaysAfter(weather: WeatherData, d: Day, max: number): number {
  let n = 0;
  for (let i = d.idx + 1; i <= d.idx + max; i++) {
    const next = getDay(weather, i);
    if (!next || isWet(next)) break;
    n++;
  }
  return n;
}

function evalCar(weather: WeatherData, d: Day, loc: string): Evaluation {
  const D = cap(dayRef(d));
  const next1 = getDay(weather, d.idx + 1);
  const next2 = getDay(weather, d.idx + 2);
  const prev = getDay(weather, d.idx - 1);

  if (isWet(d)) {
    return {
      verdict: 'poor',
      headlines: [
        'Yıkatma, para sokağa gitmesin ☔',
        'Yağmur arabayı zaten yıkayacak, oto yıkamaya gerek yok 😄',
        'Sünger elden bırakılsın, gökyüzü sulamaya hazırlanıyor 🌧️',
      ],
      detail: `${D} ${loc} ${precipText(d)} bekleniyor; yıkanan araç kısa sürede çamurlanır.`,
    };
  }
  if (next1 && isWet(next1)) {
    return {
      verdict: 'poor',
      headlines: [
        'Yıkatmayı ertele, yağmur yolda 🌧️',
        'Arabayı yıkatma, ertesi gün çamura bulanacak 🚗💦',
      ],
      detail: `${D} hava kuru ama ${dayRef(next1)} ${precipText(next1)} bekleniyor; yeni yıkanmış araba çamur içinde kalabilir.`,
    };
  }
  if (d.lo <= 1) {
    return {
      verdict: 'fair',
      headlines: ['Soğukta yıkatma, kapılar donmasın 🥶', 'Don riski var, yıkatırsan iyice kurulat ❄️'],
      detail: `${D} ${loc} sıcaklık ${d.lo}°C'ye kadar düşüyor; kapı fitilleri ve kilitlerde kalan su donabilir. Yıkatacaksan öğle saatlerini seç ve aracı iyice kurulat.`,
    };
  }
  if (d.wind >= 40) {
    return {
      verdict: 'fair',
      headlines: ['Rüzgar toz kaldırabilir, iki kez düşün 🌬️', 'Rüzgarlı günde yıkanan araba tozla buluşur 💨'],
      detail: `${D} ${loc} rüzgar ${d.wind} km/s'ye kadar çıkıyor; yıkanan araç kısa sürede toz tutabilir. Kapalı bir oto yıkama tercih edebilirsin.`,
    };
  }
  if (next2 && isWet(next2)) {
    return {
      verdict: 'fair',
      headlines: ['Yıkatabilirsin ama temizlik kısa sürecek 🌦️', 'Kısa süreli parlaklık için olur, yağmur iki gün sonra 🚗'],
      detail: `${D} ve ertesi gün kuru, ancak ${dayRef(next2)} ${precipText(next2)} bekleniyor. Hızlı bir dış yıkama yeterli olur.`,
    };
  }
  if (isIffy(d)) {
    return {
      verdict: 'fair',
      headlines: ['Gözün bulutlarda olsun, sağanak ihtimali var 🌦️'],
      detail: `${D} ${loc} %${d.prob} yağış ihtimali var. Yıkatacaksan sabah saatlerini tercih et.`,
    };
  }

  const dry = dryDaysAfter(weather, d, 4);
  let detail = dry >= 2
    ? `${D} ${loc} yağış beklenmiyor ve sonraki ${dry} gün de kuru görünüyor; yıkattığın araç uzun süre temiz kalır.`
    : `${D} ${loc} yağış beklenmiyor; yıkattığın araç temiz kalır.`;
  if (prev && prev.sum >= 2) {
    detail += ' Önceki gün yağan yağmur yüzünden yollar çamurlu olabilir; yıkamayı öğleden sonraya bırak.';
  }
  return {
    verdict: 'good',
    headlines: [
      'Arabayı yıkatmanın tam zamanı! 🚗✨',
      'Kova, sünger hazır mı? Araba yıkama günü! 🧽',
      'Arabanı yıkat, pırıl pırıl kalsın ✨',
    ],
    detail,
  };
}

function evalWindows(weather: WeatherData, d: Day, loc: string): Evaluation {
  const D = cap(dayRef(d));
  const next1 = getDay(weather, d.idx + 1);

  if (isWet(d)) {
    return {
      verdict: 'poor',
      headlines: [
        'Dış camları silme, yağmur damla damla iz bırakacak ☔',
        'Camları yağmur sulayacak, sen iç camlara odaklan 😅',
      ],
      detail: `${D} ${loc} ${precipText(d)} bekleniyor; dış camlar kısa sürede lekelenir. İç camlar için uygun bir gün.`,
    };
  }
  if (next1 && isWet(next1)) {
    return {
      verdict: 'poor',
      headlines: ['Dış camları sonraya bırak, yağmur geliyor 🌧️', 'Cam silmeyi ertele, emeğin yağmura gitmesin 🪟'],
      detail: `${D} hava kuru ama ${dayRef(next1)} ${precipText(next1)} bekleniyor; yeni silinmiş dış camlar damla izleriyle dolabilir.`,
    };
  }
  if (d.wind >= 35) {
    return {
      verdict: 'fair',
      headlines: ['Rüzgar toz taşıyor, camlar çabuk kirlenir 🌬️', 'Rüzgarlı günde cam silmek emeğe yazık 💨'],
      detail: `${D} ${loc} rüzgar ${d.wind} km/s'ye ulaşıyor; ıslak cama toz yapışır. Balkon ve yüksek camlarda da dikkatli ol.`,
    };
  }
  if (d.hi >= 32) {
    return {
      verdict: 'fair',
      headlines: ['Sıcakta cam silmek iz bırakır ☀️', 'Güneş tepedeyken cam silme, iz kalır 😎'],
      detail: `${D} ${loc} sıcaklık ${d.hi}°C; deterjan cam üzerinde hemen kurur ve iz bırakır. Sabah erken ya da güneş çekildikten sonra sil.`,
    };
  }
  if (d.lo <= 1) {
    return {
      verdict: 'fair',
      headlines: ['Soğukta dış camları kısa tut 🥶'],
      detail: `${D} ${loc} sıcaklık ${d.lo}°C'ye düşüyor; dış camlarda su donup iz bırakabilir. Ilık su ve öğle saatlerini tercih et.`,
    };
  }
  if (isIffy(d)) {
    return {
      verdict: 'fair',
      headlines: ['Cam silinir ama sağanak sürprizine hazır ol 🌦️'],
      detail: `${D} ${loc} %${d.prob} yağış ihtimali var; önce iç camlarla başla, hava açık kalırsa dışarıya geç.`,
    };
  }

  let detail = `${D} ${loc} yağış yok, rüzgar hafif (${d.wind} km/s)`;
  if (d.code === 2 || d.code === 3) {
    detail += '; bulutlu hava camın hızlı kurumasını engellediği için iz bırakmadan silmek daha kolay.';
  } else if (d.hi >= 25) {
    detail += '; güneş camı çabuk kurutup iz bırakabileceğinden sabah erken ya da akşamüstü sil.';
  } else {
    detail += '.';
  }
  if (next1) detail += ' Ertesi gün de yağmur beklenmiyor.';
  return {
    verdict: 'good',
    headlines: [
      'Camları silmek için harika bir gün! 🪟✨',
      'Cam silme günü: lekesiz camlar garanti 🧼',
      'Güneş camlardan pırıl pırıl girsin, tam zamanı ✨',
    ],
    detail,
  };
}

function evalLaundry(_weather: WeatherData, d: Day, loc: string): Evaluation {
  const D = cap(dayRef(d));

  if (isWet(d) || d.prob >= 40) {
    return {
      verdict: 'poor',
      headlines: ['Çamaşırları içeride kurut, yağmur var ☔', 'Balkona asma, çamaşırlar ikinci kez yıkanmasın 😄'],
      detail: `${D} ${loc} ${precipText(d)} bekleniyor; dışarı astığın çamaşırlar ıslanabilir.`,
    };
  }
  if (d.hi < 8) {
    return {
      verdict: 'fair',
      headlines: ['Çamaşır yavaş kurur, sabırlı ol 🧺', 'Soğukta çamaşır kurumaz, kalorifer yanına 🧦'],
      detail: `${D} ${loc} en yüksek sıcaklık ${d.hi}°C; dışarıda kuruma yavaş olur, kalın parçaları içeride kurut.`,
    };
  }
  if (d.wind >= 40) {
    return {
      verdict: 'fair',
      headlines: ['Mandalları sağlam tak, rüzgar sert 🌬️'],
      detail: `${D} ${loc} rüzgar ${d.wind} km/s'ye çıkıyor; çamaşırlar hızlı kurur ama uçmasın diye mandalları sağlam tak.`,
    };
  }
  if (d.humidity !== null && d.humidity >= 80) {
    return {
      verdict: 'fair',
      headlines: ['Nem yüksek, çamaşır geç kurur 💧'],
      detail: `${D} ${loc} gün içi nem ortalama %${Math.round(d.humidity)}; çamaşırlar dışarıda geç kurur, ince parçaları tercih et.`,
    };
  }

  let detail = `${D} ${loc} yağış beklenmiyor, sıcaklık ${d.hi}°C`;
  detail += d.hi >= 24 ? '; çamaşırlar birkaç saatte kurur.' : '; çamaşırlar gün içinde kurur.';
  if (d.prob >= 20) detail += ` Yine de %${d.prob} yağış ihtimalini akılda tut.`;
  else if (d.uv >= 7) detail += ' Renkli giysileri ters çevirerek as, güçlü güneş soldurabilir.';
  return {
    verdict: 'good',
    headlines: [
      'Çamaşırları balkona as, güneş senden yana! 👕☀️',
      'Çamaşır günü! Güneş ve rüzgar işini görecek 🧺',
      'Makineyi çalıştır, çamaşırlar mis gibi kuruyacak 🌞',
    ],
    detail,
  };
}

const EVALUATORS: Record<ActivityId, (w: WeatherData, d: Day, loc: string) => Evaluation> = {
  arac: evalCar,
  cam: evalWindows,
  camasir: evalLaundry,
};

// --- assembly ---------------------------------------------------------------

function bestDay(
  weather: WeatherData,
  id: ActivityId,
  from: number,
  to: number,
  loc: string,
): { day: Day; ev: Evaluation } | null {
  let best: { day: Day; ev: Evaluation } | null = null;
  for (let i = from; i < to; i++) {
    const day = getDay(weather, i);
    if (!day) break;
    const ev = EVALUATORS[id](weather, day, loc);
    if (!best || SCORE[ev.verdict] > SCORE[best.ev.verdict]) best = { day, ev };
    if (ev.verdict === 'good') break;
  }
  return best;
}

/**
 * Chore advice for a location page. Single-day pages (bugün / yarın /
 * saatlik / landing) judge that day and point to a better day when it is not
 * suitable; multi-day pages pick the best day of the coming week.
 */
export function getActivityAdvice(
  weather: WeatherData,
  periodId: PeriodId,
  cityName: string,
): ActivityAdviceSet | null {
  const loc = getCityLocative(cityName);
  const isRange = periodId === '7gun' || periodId === '10gun' || periodId === '15gun';
  const target = periodId === 'bugun' || periodId === 'saatlik' || isRange ? 0 : 1;
  const targetDay = getDay(weather, target);
  if (!targetDay) return null;

  const items: ActivityAdvice[] = [];
  for (const a of ACTIVITIES) {
    let day = targetDay;
    let ev = EVALUATORS[a.id](weather, day, loc);
    let detail = ev.detail;

    if (isRange) {
      const best = bestDay(weather, a.id, 0, LOOKAHEAD_DAYS, loc);
      if (!best) continue;
      ({ day, ev } = best);
      detail = ev.detail;
      if (ev.verdict !== 'good') {
        detail += ' Önümüzdeki 7 günde bundan daha uygun bir gün görünmüyor.';
      }
    } else if (ev.verdict !== 'good') {
      const alt = bestDay(weather, a.id, target + 1, target + LOOKAHEAD_DAYS, loc);
      if (alt && alt.ev.verdict === 'good') {
        detail += ` Daha uygun gün: ${cap(dayRef(alt.day))}.`;
      }
    }

    const headline = pick(ev.headlines, `${cityName}|${day.date}|${a.id}`);
    const where = `${loc} ${dayRef(day)}`;
    items.push({
      id: a.id,
      emoji: a.emoji,
      title: a.title,
      verdict: ev.verdict,
      verdictLabel: VERDICT_LABEL[ev.verdict],
      dayLabel: dayChip(day),
      headline,
      detail,
      shareText: `${a.emoji} ${a.title} · ${where}: ${VERDICT_LABEL[ev.verdict]} ${VERDICT_EMOJI[ev.verdict]}\n${headline}\n${detail}`,
    });
  }
  if (!items.length) return null;

  const dateText = `${dayMonth(targetDay.date)} ${weekdayName(targetDay.date)}`;
  let heading: string;
  let intro: string;
  let shareHead: string;
  let lines: string[];
  if (isRange) {
    heading = 'Bu hafta araba yıkamak ve cam silmek için en uygun gün';
    intro = `${loc} önümüzdeki 7 günün tahminine göre araç yıkama, cam silme ve çamaşır kurutma için en uygun günler.`;
    shareHead = `📋 ${loc} bu hafta en uygun günler:`;
    lines = items.map((i) => `${i.emoji} ${i.title}: ${i.dayLabel} ${VERDICT_EMOJI[i.verdict]}`);
  } else {
    const rel = target === 0 ? 'Bugün' : 'Yarın';
    heading = `${rel} araba yıkanır mı, cam silinir mi?`;
    intro = `${loc} ${rel.toLocaleLowerCase('tr-TR')} (${dateText}) beklenen havaya göre araç yıkama, cam silme ve çamaşır kurutma önerileri.`;
    shareHead = `📋 ${loc} ${rel.toLocaleLowerCase('tr-TR')} (${dateText}) ne yapılır?`;
    lines = items.map((i) => `${i.emoji} ${i.title}: ${i.verdictLabel} ${VERDICT_EMOJI[i.verdict]}`);
  }

  return {
    heading,
    intro,
    items,
    shareText: [shareHead, ...lines].join('\n'),
  };
}
