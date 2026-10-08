/**
 * Hero background for a weather code, matching the .sky-* classes in
 * src/styles/global.css. public/scripts/weather-now.js mirrors this mapping to
 * re-tint the hero for the visitor's current hour - keep the two in sync.
 * The browser additionally uses sky-dawn / sky-dusk around sunrise and sunset;
 * the static page always describes noon, so it never needs them.
 */
export function getSkyClass(code: number, isDay: boolean): string {
  const t = isDay ? 'day' : 'night';
  if (code === 0 || code === 1) return `sky-clear-${t}`;
  if (code === 2) return `sky-partly-${t}`;
  if (code === 3) return `sky-cloudy-${t}`;
  if (code === 45 || code === 48) return `sky-fog-${t}`;
  if (code >= 95) return 'sky-storm';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return `sky-snow-${t}`;
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return `sky-rain-${t}`;
  return `sky-partly-${t}`;
}
