import { PROVINCE_PATHS, MAP_VIEWBOX } from '../data/turkeyProvinces.ts';
import { centre } from './mapGeometry.ts';
import { tempTint, tempColor } from './tempScale.ts';
import { longDate } from './bulletin.ts';
import { OG_WIDTH, OG_HEIGHT } from './ogImage.ts';

/**
 * Share image of a bulletin (/og/bulten/<date>.png): the day's highs on the
 * province map, 1200x630, large enough for Discover's large previews. Every
 * province is filled with the site's temperature scale and carries its
 * number; the date sits in the header, so a cached preview never passes for
 * another day's map.
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function buildBulletinSvg(date: string, points: { plate: number; temp: number }[]): string {
  const [vx, vy, vw, vh] = MAP_VIEWBOX.split(' ').map(Number);
  const top = 110;
  const scale = Math.min((OG_WIDTH - 60) / vw, (OG_HEIGHT - top - 20) / vh);
  const ox = (OG_WIDTH - vw * scale) / 2 - vx * scale;
  const oy = top - vy * scale;

  const shapes: string[] = [];
  const labels: string[] = [];
  for (const p of points) {
    const d = PROVINCE_PATHS[p.plate];
    if (!d) continue;
    shapes.push(`<path d="${d}" fill="${tempTint(p.temp, 0.15)}" stroke="#ffffff" stroke-width="1.2"/>`);
    const c = centre(d);
    // Labels are drawn unscaled so the text stays crisp and readable.
    const x = (ox + c.x * scale).toFixed(1);
    const y = (oy + c.y * scale + 6).toFixed(1);
    labels.push(`<text x="${x}" y="${y}" font-size="${c.w * scale < 34 ? 13 : 16}" font-weight="800" fill="#10203a" text-anchor="middle">${p.temp}°</text>`);
  }
  const temps = points.map((p) => p.temp);
  const lo = Math.min(...temps);
  const hi = Math.max(...temps);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}" font-family="Figtree">
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="#f4f7fb"/>
  <text x="48" y="62" font-size="40" font-weight="800" fill="#10203a">${esc(longDate(date))}</text>
  <text x="48" y="96" font-size="24" font-weight="600" fill="#4a5a72">Türkiye hava durumu · il merkezlerinde en yüksek sıcaklık</text>
  <text x="1152" y="62" font-size="28" font-weight="800" fill="#10203a" text-anchor="end">Yarın Hava</text>
  <text x="1152" y="96" font-size="22" font-weight="600" fill="#4a5a72" text-anchor="end">yarinhava.com</text>
  <g transform="translate(${ox.toFixed(1)} ${oy.toFixed(1)}) scale(${scale.toFixed(4)})">${shapes.join('')}</g>
  ${labels.join('')}
  ${Number.isFinite(lo) ? `<g transform="translate(48 590)">
    <rect width="22" height="22" rx="6" fill="${tempColor(lo)}"/><text x="30" y="18" font-size="20" font-weight="600" fill="#4a5a72">${lo}°</text>
    <rect x="90" width="22" height="22" rx="6" fill="${tempColor(hi)}"/><text x="120" y="18" font-size="20" font-weight="600" fill="#4a5a72">${hi}°</text>
  </g>` : ''}
</svg>`;
}
