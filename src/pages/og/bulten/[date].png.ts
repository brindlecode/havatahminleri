import type { APIRoute } from 'astro';
import { resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { loadBulletins } from '../../../lib/bulletinData';
import { buildBulletinSvg } from '../../../lib/bulletinImage';

// Share image of each bulletin: /og/bulten/2026-10-25.png (src/lib/bulletinImage.ts).

const FONT_FILES = ['400Regular', '600SemiBold', '800ExtraBold'].map((w) =>
  resolve(process.cwd(), `src/assets/og-fonts/Figtree_${w}.ttf`),
);

export function getStaticPaths() {
  return loadBulletins().map(({ bulletin }) => ({
    params: { date: bulletin.date },
    props: { date: bulletin.date, points: bulletin.mapPoints },
  }));
}

export const GET: APIRoute = ({ props }) => {
  const svg = buildBulletinSvg(props.date as string, props.points as { plate: number; temp: number }[]);
  const png = new Resvg(svg, {
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'Figtree' },
  }).render().asPng();
  return new Response(png, { headers: { 'Content-Type': 'image/png' } });
};
