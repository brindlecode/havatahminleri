/** Visual centre of a province: area centroid of the path's vertices. */
export function centre(d: string): { x: number; y: number; w: number; h: number } {
  const n = d.match(/-?\d+/g)!.map(Number);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i + 1 < n.length; i += 2) { xs.push(n[i]); ys.push(n[i + 1]); }
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < xs.length; i++) {
    const j = (i + 1) % xs.length;
    const f = xs[i] * ys[j] - xs[j] * ys[i];
    a += f; cx += (xs[i] + xs[j]) * f; cy += (ys[i] + ys[j]) * f;
  }
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  if (Math.abs(a) < 1e-6) return { x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2, w, h };
  return { x: cx / (3 * a), y: cy / (3 * a), w, h };
}
