import type { APIRoute } from 'astro';
import { resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { fetchWeatherData } from '../../lib/weather';
import { getLocationNames } from '../../lib/seo';
import { buildOgSvg, ogImageSlug, type OgImageInput } from '../../lib/ogImage';
import provinces from '../../data/provinces.json';
import districts from '../../data/districts.json';

// Share images (og:image) for every location, for today and tomorrow:
// /og/kocaeli-2026-10-05.png, /og/kocaeli/izmit-2026-10-05.png.
// See src/lib/ogImage.ts.

const FONT_FILES = ['400Regular', '600SemiBold', '800ExtraBold'].map((w) =>
  resolve(process.cwd(), `src/assets/og-fonts/Figtree_${w}.ttf`),
);

export async function getStaticPaths() {
  const paths: { params: { path: string }; props: OgImageInput }[] = [];

  const add = async (
    loc: { provinceName: string; provinceSlug: string; districtName?: string; districtSlug?: string; lat: number; lon: number },
  ) => {
    const weather = await fetchWeatherData(loc.lat, loc.lon);
    const names = getLocationNames(loc);
    for (const dayIndex of [0, 1] as const) {
      const date = weather.daily.time[dayIndex];
      if (!date) continue;
      paths.push({
        params: { path: ogImageSlug(loc.provinceSlug, loc.districtSlug ?? null, date) },
        props: {
          weather,
          dayIndex,
          title: names.short,
          provinceName: loc.districtName ? loc.provinceName : null,
          displayName: names.display,
        },
      });
    }
  };

  for (const p of provinces) {
    await add({ provinceName: p.name, provinceSlug: p.slug, lat: p.lat, lon: p.lon });
  }
  for (const d of districts) {
    const p = provinces.find((x) => x.slug === d.province);
    if (!p) continue;
    await add({
      provinceName: p.name, provinceSlug: p.slug,
      districtName: d.name, districtSlug: d.slug,
      lat: d.lat, lon: d.lon,
    });
  }
  return paths;
}

export const GET: APIRoute = ({ props }) => {
  const svg = buildOgSvg(props as OgImageInput);
  const png = new Resvg(svg, {
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'Figtree' },
  }).render().asPng();
  return new Response(png, { headers: { 'Content-Type': 'image/png' } });
};
