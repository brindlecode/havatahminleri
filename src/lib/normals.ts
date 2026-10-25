import type { DailyForecast } from './weather.ts';
import { MONTHS, type ClimateMonth } from './climate.ts';
import { weekdayName, dayMonth } from './periodSummary.ts';

/**
 * The forecast set against the season: how far each forecast day sits from
 * the province's climate normal for that date (src/data/climate.json,
 * 2015-2024 ERA5 averages, written by scripts/fetch-climate.mjs).
 *
 * This is information no other copy of the raw forecast carries, so it is
 * what gives two forecast pages with similar numbers different, checkable
 * content. Everything here is derived from data already in the build: no API
 * call is made.
 *
 * Monthly normals are treated as the value at mid-month and interpolated
 * linearly between neighbouring months, so a 30 October forecast is
 * compared with a value between the October and November normals rather than
 * with the October average, which in spring and autumn can differ by 4-5°.
 */

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export interface DayNormal {
  hi: number;
  lo: number;
  /** Mean precipitation per day, mm (the monthly total spread over the month). */
  precip: number;
}

export function dailyNormal(rows: ClimateMonth[], date: string): DayNormal {
  const [y, m, d] = date.split('-').map(Number);
  const month = m - 1;
  const len = month === 1 && y % 4 === 0 ? 29 : DAYS_IN_MONTH[month];
  // Position relative to this month's midpoint, in months (-0.5 .. +0.5).
  const offset = (d - 0.5 - len / 2) / len;
  const other = offset >= 0 ? (month + 1) % 12 : (month + 11) % 12;
  const w = Math.abs(offset);
  const a = rows[month];
  const b = rows[other];
  const mix = (x: number, z: number) => x * (1 - w) + z * w;
  return {
    hi: mix(a.hi, b.hi),
    lo: mix(a.lo, b.lo),
    precip: mix(a.precip / len, b.precip / DAYS_IN_MONTH[other]),
  };
}

export type AnomalyBand = 'much-colder' | 'colder' | 'normal' | 'warmer' | 'much-warmer';

/** Band of a high-temperature difference from normal, in °C. */
export function anomalyBand(diff: number): AnomalyBand {
  if (diff >= 5) return 'much-warmer';
  if (diff >= 2) return 'warmer';
  if (diff <= -5) return 'much-colder';
  if (diff <= -2) return 'colder';
  return 'normal';
}

export const BAND_LABEL: Record<AnomalyBand, string> = {
  'much-colder': 'normalin çok altında',
  colder: 'normalin altında',
  normal: 'normal civarında',
  warmer: 'normalin üzerinde',
  'much-warmer': 'normalin çok üzerinde',
};

export interface DayComparison {
  date: string;
  hi: number;
  lo: number;
  normalHi: number;
  normalLo: number;
  /** Forecast high minus normal high, rounded to whole degrees. */
  diff: number;
  band: AnomalyBand;
  /** The forecast high beats the highest value of that month in 2015-2024. */
  aboveRecord: boolean;
  /** The forecast low is under the lowest value of that month in 2015-2024. */
  belowRecord: boolean;
}

export interface NormalsComparison {
  days: DayComparison[];
  /** Mean of the daily high differences, one decimal. */
  meanDiff: number;
  warmerDays: number;
  colderDays: number;
  /** Forecast precipitation total over the range, mm. */
  precip: number;
  /** Normal precipitation over the same dates, mm. */
  normalPrecip: number;
  /** One or two sentences summarising the range against the season. */
  summary: string;
}

const r = Math.round;
const deg = (n: number) => `${r(n)}°`;
/** "+4°", "-2°", "0°". */
export const signedDiff = (n: number) => (n > 0 ? `+${n}°` : `${n}°`);
const day = (date: string) => `${dayMonth(date)} ${weekdayName(date)}`;

/** "4°" / "1°" difference phrase: "normalinden 4° yüksek". */
function diffPhrase(diff: number): string {
  if (diff === 0) return 'normaliyle aynı';
  return `normalinden ${Math.abs(diff)}° ${diff > 0 ? 'yüksek' : 'düşük'}`;
}

/**
 * Compare `count` forecast days from `start` with the climate normals.
 * Returns null when the province has no normals yet or the range is empty.
 */
export function compareToNormals(
  rows: ClimateMonth[] | null,
  daily: DailyForecast,
  start: number,
  count: number,
  cityLocative: string,
): NormalsComparison | null {
  if (!rows || rows.length !== 12) return null;
  const end = Math.min(daily.time.length, start + count);
  if (end <= start) return null;

  const days: DayComparison[] = [];
  let precip = 0;
  let normalPrecip = 0;
  for (let i = start; i < end; i++) {
    const date = daily.time[i];
    const hi = daily.temperatureMax[i];
    const lo = daily.temperatureMin[i];
    if (!date || !Number.isFinite(hi) || !Number.isFinite(lo)) continue;
    const n = dailyNormal(rows, date);
    const month = rows[Number(date.slice(5, 7)) - 1];
    const diff = r(hi) - r(n.hi);
    days.push({
      date,
      hi,
      lo,
      normalHi: n.hi,
      normalLo: n.lo,
      diff,
      band: anomalyBand(diff),
      aboveRecord: hi > month.recordHi,
      belowRecord: lo < month.recordLo,
    });
    precip += daily.precipitationSum[i] ?? 0;
    normalPrecip += n.precip;
  }
  if (!days.length) return null;

  const meanDiff = r((days.reduce((s, x) => s + (x.hi - x.normalHi), 0) / days.length) * 10) / 10;
  const warmerDays = days.filter((x) => x.diff >= 2).length;
  const colderDays = days.filter((x) => x.diff <= -2).length;

  return {
    days,
    meanDiff,
    warmerDays,
    colderDays,
    precip: r(precip * 10) / 10,
    normalPrecip: r(normalPrecip * 10) / 10,
    summary: summarise(days, meanDiff, warmerDays, colderDays, precip, normalPrecip, cityLocative),
  };
}

function summarise(
  days: DayComparison[],
  meanDiff: number,
  warmerDays: number,
  colderDays: number,
  precip: number,
  normalPrecip: number,
  loc: string,
): string {
  const parts: string[] = [];

  if (days.length === 1) {
    const d = days[0];
    const vs = d.diff === 0
      ? `mevsim normaliyle (${deg(d.normalHi)}) aynı`
      : `${deg(d.normalHi)} olan mevsim normalinin ${Math.abs(d.diff)}° ${d.diff > 0 ? 'üzerinde' : 'altında'}`;
    parts.push(`${loc} ${day(d.date)} için beklenen en yüksek sıcaklık ${deg(d.hi)}; bu, ${vs}.`);
    if (d.band === 'normal') parts.push('Hava mevsimine uygun seyrediyor.');
    else if (d.band === 'much-warmer') parts.push('Mevsimine göre belirgin şekilde sıcak bir gün bekleniyor.');
    else if (d.band === 'much-colder') parts.push('Mevsimine göre belirgin şekilde soğuk bir gün bekleniyor.');
  } else {
    const n = days.length;
    const avg = Math.abs(meanDiff).toLocaleString('tr-TR', { maximumFractionDigits: 1 });
    if (Math.abs(meanDiff) < 1.5) {
      parts.push(`${loc} önümüzdeki ${n} gün sıcaklıklar genel olarak mevsim normalleri civarında seyrediyor (ortalama fark ${avg}°).`);
    } else {
      parts.push(
        `${loc} önümüzdeki ${n} gün gündüz sıcaklıkları mevsim normallerinin ortalama ${avg}° ${meanDiff > 0 ? 'üzerinde' : 'altında'}.`,
      );
    }
    if (warmerDays === n || colderDays === n) {
      parts.push(`${n} günün tamamı normalden ${warmerDays === n ? 'sıcak' : 'soğuk'} geçiyor.`);
    } else {
      const counts: string[] = [];
      if (warmerDays) counts.push(`${warmerDays} günü normalden sıcak`);
      if (colderDays) counts.push(`${colderDays} günü normalden soğuk`);
      if (counts.length) parts.push(`${n} günün ${counts.join(', ')} geçiyor.`);
    }

    const extreme = days.reduce((a, b) => (Math.abs(b.diff) > Math.abs(a.diff) ? b : a));
    if (Math.abs(extreme.diff) >= 4) {
      parts.push(`En büyük sapma ${day(extreme.date)}: ${deg(extreme.hi)}, ${diffPhrase(extreme.diff)}.`);
    }
    if (n >= 7 && normalPrecip >= 3) {
      const ratio = precip / normalPrecip;
      const total = `${r(precip)} mm`;
      const normal = `${r(normalPrecip)} mm`;
      if (ratio >= 1.5) parts.push(`Bu dönemde beklenen toplam yağış (${total}) normalin (${normal}) belirgin şekilde üzerinde.`);
      else if (ratio <= 0.5) parts.push(`Bu dönemde beklenen toplam yağış (${total}) normalin (${normal}) altında; dönem kurak geçiyor.`);
      else parts.push(`Beklenen toplam yağış (${total}) mevsim normaline (${normal}) yakın.`);
    }
  }

  const record = days.find((x) => x.aboveRecord) ?? days.find((x) => x.belowRecord);
  if (record) {
    const month = MONTHS[Number(record.date.slice(5, 7)) - 1].name;
    parts.push(
      record.aboveRecord
        ? `${day(record.date)} beklenen ${deg(record.hi)}, 2015-2024 döneminde ${month} ayında görülen en yüksek değerin de üzerinde.`
        : `${day(record.date)} beklenen ${deg(record.lo)}, 2015-2024 döneminde ${month} ayında görülen en düşük değerin de altında.`,
    );
  }

  return parts.join(' ');
}
