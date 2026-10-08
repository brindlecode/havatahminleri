import type { WeatherData } from './weather.ts';

/**
 * Severe-weather alerts derived from the forecast itself, for today and
 * tomorrow. These are the site's own alerts, not the official warnings of the
 * Turkish State Meteorological Service: they are labelled "Dikkat" and
 * "Tehlike" (never the official yellow / orange / red codes) and every place
 * that shows them links to MGM's MeteoUyarı.
 *
 * Thresholds are on the daily values the forecast carries: total
 * precipitation, highest sustained wind, temperature extremes and the day's
 * dominant weather code.
 */

export type AlertKind = 'storm' | 'rain' | 'snow' | 'wind' | 'heat' | 'cold';
export type AlertLevel = 1 | 2; // 1 Dikkat, 2 Tehlike

export interface Alert {
  day: 0 | 1;
  kind: AlertKind;
  level: AlertLevel;
  /** "Kuvvetli yağış" */
  title: string;
  /** One sentence with the number that triggered it. */
  detail: string;
}

export const ALERT_LEVEL_LABEL: Record<AlertLevel, string> = { 1: 'Dikkat', 2: 'Tehlike' };
export const ALERT_KIND_LABEL: Record<AlertKind, string> = {
  storm: 'Gök gürültülü sağanak',
  rain: 'Kuvvetli yağış',
  snow: 'Kar yağışı',
  wind: 'Kuvvetli rüzgar',
  heat: 'Aşırı sıcak',
  cold: 'Aşırı soğuk',
};
export const MGM_WARNINGS_URL = 'https://www.mgm.gov.tr/meteouyari/';

const isSnow = (c: number) => (c >= 71 && c <= 77) || c === 85 || c === 86;
const mm = (v: number) => `${Math.round(v)} mm`;

export function getAlerts(weather: WeatherData): Alert[] {
  const d = weather.daily;
  const out: Alert[] = [];
  for (const day of [0, 1] as const) {
    if (d.time[day] === undefined) continue;
    const code = d.weatherCode[day] ?? 0;
    const rain = d.precipitationSum?.[day] ?? 0;
    const prob = d.precipitationProbabilityMax?.[day] ?? 100;
    const wind = d.windSpeedMax?.[day] ?? 0;
    const hi = d.temperatureMax[day];
    const lo = d.temperatureMin[day];

    if (code >= 95) {
      const hail = code === 96 || code === 99;
      out.push({
        day,
        kind: 'storm',
        level: rain >= 50 ? 2 : 1,
        title: hail ? 'Gök gürültülü sağanak ve dolu' : ALERT_KIND_LABEL.storm,
        detail: `${rain >= 1 ? `Toplam ${mm(rain)} yağış bekleniyor. ` : ''}Ani sel, yıldırım${hail ? ' ve dolu' : ''} riskine karşı açık alanda uzun kalmayın.`,
      });
    } else if (isSnow(code) && rain >= 3) {
      out.push({
        day,
        kind: 'snow',
        level: rain >= 10 ? 2 : 1,
        title: rain >= 10 ? 'Yoğun kar yağışı' : ALERT_KIND_LABEL.snow,
        detail: `Yaklaşık ${Math.round(rain)} cm kar bekleniyor. Buzlanma ve ulaşımda aksamalara hazırlıklı olun.`,
      });
    } else if (rain >= 25 && prob >= 50) {
      out.push({
        day,
        kind: 'rain',
        level: rain >= 50 ? 2 : 1,
        title: ALERT_KIND_LABEL.rain,
        detail: `Gün boyu toplam ${mm(rain)} yağış bekleniyor. Su baskını ve sel riskine karşı dikkatli olun.`,
      });
    }

    if (wind >= 50) {
      out.push({
        day,
        kind: 'wind',
        level: wind >= 65 ? 2 : 1,
        title: wind >= 65 ? 'Fırtına' : ALERT_KIND_LABEL.wind,
        detail: `Rüzgar saatte ${Math.round(wind)} km'ye kadar çıkıyor. Çatı uçması, ağaç ve direk devrilmesine karşı dikkatli olun.`,
      });
    }

    if (hi >= 38) {
      out.push({
        day,
        kind: 'heat',
        level: hi >= 42 ? 2 : 1,
        title: ALERT_KIND_LABEL.heat,
        detail: `Sıcaklık ${Math.round(hi)}°'ye çıkıyor. 11:00-16:00 arasında güneşe çıkmayın, bol su için.`,
      });
    } else if (lo <= -15) {
      out.push({
        day,
        kind: 'cold',
        level: lo <= -25 ? 2 : 1,
        title: ALERT_KIND_LABEL.cold,
        detail: `Sıcaklık ${Math.round(lo)}°'ye düşüyor. Don ve buzlanmaya, su borularının donmasına karşı önlem alın.`,
      });
    }
  }
  return out.sort((a, b) => b.level - a.level || a.day - b.day);
}

/** Highest alert level over today and tomorrow; 0 when none. */
export const maxAlertLevel = (alerts: Alert[]): 0 | AlertLevel =>
  alerts.reduce<0 | AlertLevel>((m, a) => (a.level > m ? a.level : m), 0);
