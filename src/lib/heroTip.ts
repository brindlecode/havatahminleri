import type { WeatherData } from './weather.ts';
import type { PeriodId } from './periods.ts';

/**
 * The one-line answer in the hero: what the visitor should do about the
 * weather on the day the page is about ("Şemsiyeni al. Yağış en çok 14:00 ile
 * 18:00 arasında bekleniyor."). Every rule reads the forecast arrays; the
 * first rule that applies wins, from the most disruptive weather down.
 */
export interface HeroTip {
  /** "Bugün" or "Yarın" - the day the tip is about. */
  day: string;
  /** Short imperative lead, shown in bold. */
  lead: string;
  /** One supporting sentence with the numbers. */
  detail: string;
}

const pad = (h: number) => `${String(h).padStart(2, '0')}:00`;

export function getHeroTip(weather: WeatherData, period: PeriodId): HeroTip | null {
  const dayIdx = period === 'base' || period === 'yarin' ? 1 : 0;
  const { daily, hourly } = weather;
  if (daily.time[dayIdx] === undefined) return null;

  const hi = Math.round(daily.temperatureMax[dayIdx]);
  const lo = Math.round(daily.temperatureMin[dayIdx]);
  const wind = Math.round(daily.windSpeedMax?.[dayIdx] ?? 0);
  const uv = Math.round(daily.uvIndexMax?.[dayIdx] ?? 0);
  const day = dayIdx === 0 ? 'Bugün' : 'Yarın';

  // Waking hours (06-23) of that day from the 48-hour series.
  const hours: { h: number; code: number; prob: number }[] = [];
  for (let h = 6; h < 24; h++) {
    const i = dayIdx * 24 + h;
    if (hourly.time[i] === undefined) continue;
    hours.push({ h, code: hourly.weatherCode[i], prob: hourly.precipitationProbability[i] ?? 0 });
  }
  const maxProb = hours.length
    ? Math.max(...hours.map((x) => x.prob))
    : Math.round(daily.precipitationProbabilityMax?.[dayIdx] ?? 0);

  const window = (pred: (x: { code: number; prob: number }) => boolean) => {
    const hit = hours.filter(pred);
    if (!hit.length) return null;
    const first = hit[0].h;
    const last = hit[hit.length - 1].h;
    if (first === last) return `${pad(first)} civarı`;
    return last >= 23 ? `${pad(first)} ile gece yarısı arasında` : `${pad(first)} ile ${pad(last + 1)} arasında`;
  };

  const storm = window((x) => x.code >= 95);
  if (storm) {
    return { day, lead: 'Gök gürültülü sağanak bekleniyor.', detail: `En riskli saatler ${storm}. Açık alanda uzun kalmamaya çalış.` };
  }

  const snow = window((x) => (x.code >= 71 && x.code <= 77) || x.code === 85 || x.code === 86);
  if (snow) {
    return { day, lead: 'Kar yağışı bekleniyor.', detail: `Kar en çok ${snow} bekleniyor. Sıcaklık ${lo}° ile ${hi}° arasında; yollarda dikkatli ol.` };
  }

  if (maxProb >= 50) {
    const wet = window((x) => x.prob >= 40);
    return {
      day,
      lead: 'Şemsiyeni al.',
      detail: wet ? `Yağış en çok ${wet} bekleniyor (olasılık %${maxProb}).` : `Yağış olasılığı %${maxProb}.`,
    };
  }

  if (maxProb >= 25) {
    return { day, lead: 'Yanına şemsiye almak iyi olur.', detail: `Yağış olasılığı en fazla %${maxProb}; sıcaklık ${lo}° ile ${hi}° arasında.` };
  }

  if (hi >= 33) {
    return {
      day,
      lead: 'Çok sıcak bir gün.',
      detail: `En yüksek ${hi}°. Öğle saatlerinde gölgede kal${uv >= 6 ? `, UV indeksi ${uv}` : ''} ve bol su iç.`,
    };
  }

  if (lo <= 2) {
    return { day, lead: 'Kalın giyin.', detail: `Sıcaklık ${lo}°'ye kadar düşüyor, gün içinde en fazla ${hi}°.` };
  }

  if (wind >= 40) {
    return { day, lead: 'Rüzgarlı bir gün.', detail: `Rüzgar saatte ${wind} km'ye kadar çıkıyor; sıcaklık ${lo}° ile ${hi}° arasında.` };
  }

  if (uv >= 7) {
    return { day, lead: 'Güneş kremini unutma.', detail: `UV indeksi ${uv}, yüksek. Yağış beklenmiyor, en yüksek ${hi}°.` };
  }

  return { day, lead: 'Yağış beklenmiyor.', detail: `Sıcaklık ${lo}° ile ${hi}° arasında${wind >= 25 ? `, rüzgar ${wind} km/s'ye kadar` : ''}.` };
}
