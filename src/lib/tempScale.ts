/**
 * One continuous temperature colour scale for the whole site: the hourly
 * curve, the daily range bars, the home-page map and the share accents all
 * use it, so 30° is the same orange everywhere and colour alone carries the
 * temperature. Never used for text (contrast), only for marks.
 */
const STOPS: [number, [number, number, number]][] = [
  [-10, [123, 108, 246]],
  [0, [76, 141, 246]],
  [8, [56, 182, 232]],
  [15, [69, 201, 164]],
  [20, [154, 212, 90]],
  [25, [242, 199, 68]],
  [30, [245, 154, 60]],
  [35, [238, 93, 69]],
  [40, [210, 58, 92]],
];

export function tempColor(t: number): string {
  if (!Number.isFinite(t) || t <= STOPS[0][0]) return rgb(STOPS[0][1]);
  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i][0]) {
      const [t0, c0] = STOPS[i - 1];
      const [t1, c1] = STOPS[i];
      const f = (t - t0) / (t1 - t0);
      return rgb([0, 1, 2].map((k) => Math.round(c0[k] + (c1[k] - c0[k]) * f)) as [number, number, number]);
    }
  }
  return rgb(STOPS[STOPS.length - 1][1]);
}

/** CSS gradient across a temperature range, for a range bar or legend. */
export function tempGradient(min: number, max: number, angle = 90): string {
  const steps = 4;
  const colors = Array.from({ length: steps + 1 }, (_, i) => tempColor(min + ((max - min) * i) / steps));
  return `linear-gradient(${angle}deg, ${colors.join(', ')})`;
}

function rgb(c: [number, number, number]): string {
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
