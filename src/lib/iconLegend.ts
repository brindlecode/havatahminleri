import { getIconSVG } from './weatherIconSvg.ts';
import { getWeatherDescription } from './weatherCodes.ts';

/**
 * What every weather icon on the site means.
 *
 * The icons come from getIconSVG(code, isDay), and several WMO codes share one
 * drawing (light and moderate rain, for example). Each group below is one
 * distinct drawing: the legend can never show an icon the pages do not use, or
 * describe a drawing with the wrong words.
 *
 * The drawings are published once as an SVG sprite (/weather-icons.svg, see
 * src/pages/weather-icons.svg.ts); the per-page legend and the full
 * /hava-durumu-simgeleri/ page reference it with <use>, so the legend adds a
 * few hundred bytes per page instead of repeating the artwork.
 */

export interface IconGroup {
  /** Sprite symbol id, e.g. "ic-rain". */
  id: string;
  /** Representative code and day/night, used to draw the icon. */
  code: number;
  isDay: boolean;
  label: string;
  /** One-sentence plain-language meaning. */
  meaning: string;
  /** All WMO codes drawn with this icon. */
  codes: number[];
}

export const ICON_GROUPS: IconGroup[] = [
  { id: 'ic-clear-day', code: 0, isDay: true, label: 'Açık', codes: [0],
    meaning: 'Gökyüzü açık, bulut yok denecek kadar az; güneşli bir gün.' },
  { id: 'ic-clear-night', code: 0, isDay: false, label: 'Açık (gece)', codes: [0],
    meaning: 'Bulutsuz bir gece; ay ve yıldızlar görünür, sabaha karşı serin olur.' },
  { id: 'ic-mostly-day', code: 1, isDay: true, label: 'Çoğunlukla açık', codes: [1],
    meaning: 'Ara ara ince bulutlar geçer ama güneş büyük ölçüde görünür.' },
  { id: 'ic-mostly-night', code: 1, isDay: false, label: 'Çoğunlukla açık (gece)', codes: [1],
    meaning: 'Gece gökyüzü büyük ölçüde açık, yer yer ince bulutlar var.' },
  { id: 'ic-partly-day', code: 2, isDay: true, label: 'Parçalı bulutlu', codes: [2],
    meaning: 'Gökyüzünün yaklaşık yarısı bulutlu; güneş zaman zaman kapanır.' },
  { id: 'ic-partly-night', code: 2, isDay: false, label: 'Parçalı bulutlu (gece)', codes: [2],
    meaning: 'Gece gökyüzünün bir kısmı bulutlarla kaplı.' },
  { id: 'ic-cloudy', code: 3, isDay: true, label: 'Bulutlu', codes: [3],
    meaning: 'Gökyüzü tamamen ya da büyük ölçüde kapalı; güneş görünmez.' },
  { id: 'ic-fog', code: 45, isDay: true, label: 'Sis', codes: [45, 48],
    meaning: 'Görüş mesafesi düşer; kırağılı siste yollarda buzlanma olabilir.' },
  { id: 'ic-drizzle', code: 51, isDay: true, label: 'Çisenti', codes: [51, 53, 55, 56, 57],
    meaning: 'İnce damlalı, hafif ve sürekli yağış; dondurucu çisenti yolları buzlandırabilir.' },
  { id: 'ic-rain', code: 61, isDay: true, label: 'Yağmur / sağanak', codes: [61, 63, 66, 80, 81],
    meaning: 'Hafif ya da orta şiddette yağmur veya kısa süreli sağanak; şemsiye gerekir.' },
  { id: 'ic-heavy-rain', code: 65, isDay: true, label: 'Şiddetli yağmur', codes: [65, 67, 82],
    meaning: 'Yoğun yağış; su birikintileri, trafik aksamaları ve sel riskine dikkat.' },
  { id: 'ic-snow', code: 71, isDay: true, label: 'Kar', codes: [71, 73, 75, 77, 85, 86],
    meaning: 'Kar, kar taneleri ya da kar sağanağı; yollarda kayganlık olabilir.' },
  { id: 'ic-storm', code: 95, isDay: true, label: 'Gök gürültülü fırtına', codes: [95, 96, 99],
    meaning: 'Şimşek ve gök gürültüsüyle sağanak; dolu ve ani kuvvetli rüzgar görülebilir.' },
];

/** Codes that have a night drawing of their own. */
const NIGHT_CODES = new Set([0, 1, 2]);

/** The legend group drawn for a code at day or night; null for unknown codes. */
export function iconGroupFor(code: number, isDay: boolean): IconGroup | null {
  const night = !isDay && NIGHT_CODES.has(code);
  return ICON_GROUPS.find((g) => g.codes.includes(code) && g.isDay === !night) ?? null;
}

/** "Hafif Yağmur, Orta Yağmur, ..." - the forecast wordings behind a group. */
export function groupDescriptions(group: IconGroup): string[] {
  return [...new Set(group.codes.map((c) => getWeatherDescription(c)))];
}

/** Groups for the icons actually drawn on a page, in catalogue order. */
export function groupsForIcons(icons: { code: number; isDay: boolean }[]): IconGroup[] {
  const ids = new Set(
    icons.map((i) => iconGroupFor(i.code, i.isDay)?.id).filter((id): id is string => !!id),
  );
  return ICON_GROUPS.filter((g) => ids.has(g.id));
}

/** The sprite file: one <symbol> per group, 48x48 like WeatherIcon. */
export function buildIconSprite(): string {
  const symbols = ICON_GROUPS.map(
    (g) => `<symbol id="${g.id}" viewBox="0 0 48 48" fill="none">${getIconSVG(g.code, g.isDay)}</symbol>`,
  ).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg">${symbols}</svg>`;
}

export const ICON_SPRITE_PATH = '/weather-icons.svg';
export const ICON_GUIDE_PATH = '/hava-durumu-simgeleri/';
