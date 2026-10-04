import { buildIconSprite } from '../lib/iconLegend';

// SVG sprite of every weather icon, referenced by the icon legend
// (<use href="/weather-icons.svg#ic-rain">). One small cached file instead of
// repeating the artwork on every page.
export function GET() {
  return new Response(buildIconSprite(), {
    headers: { 'Content-Type': 'image/svg+xml; charset=utf-8' },
  });
}
