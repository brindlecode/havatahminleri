import type { APIRoute } from 'astro';
import { loadBulletins } from '../../lib/bulletinData';

// Google News sitemap: only articles published in the last two days belong
// in it. The site is rebuilt at least twice a day, so this stays current.
// Referenced from robots.txt.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const TWO_DAYS = 48 * 3600 * 1000;

export const GET: APIRoute = () => {
  const now = Date.now();
  const urls = loadBulletins()
    .map((x) => x.bulletin)
    .filter((b) => now - Date.parse(b.datePublished) < TWO_DAYS)
    .map((b) => `  <url>
    <loc>${b.url}</loc>
    <news:news>
      <news:publication>
        <news:name>Yarın Hava</news:name>
        <news:language>tr</news:language>
      </news:publication>
      <news:publication_date>${b.datePublished}</news:publication_date>
      <news:title>${esc(b.headline)}</news:title>
    </news:news>
  </url>`)
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${urls}
</urlset>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
