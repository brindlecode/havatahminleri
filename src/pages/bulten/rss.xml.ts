import type { APIRoute } from 'astro';
import { loadBulletins } from '../../lib/bulletinData';

// RSS 2.0 feed of the latest bulletins, for feed readers and crawlers that
// discover new URLs from feeds.

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const GET: APIRoute = () => {
  const items = loadBulletins()
    .slice(0, 30)
    .map(({ bulletin: b }) => `    <item>
      <title>${esc(b.headline)}</title>
      <link>${b.url}</link>
      <guid isPermaLink="true">${b.url}</guid>
      <pubDate>${new Date(b.datePublished).toUTCString()}</pubDate>
      <description>${esc(b.lead)}</description>
    </item>`)
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Yarın Hava - Günlük Hava Durumu Bülteni</title>
    <link>https://yarinhava.com/bulten/</link>
    <atom:link href="https://yarinhava.com/bulten/rss.xml" rel="self" type="application/rss+xml"/>
    <description>Türkiye geneli günlük hava durumu bülteni: 81 ilde sıcaklık, yağış, kar ve uyarılar.</description>
    <language>tr-TR</language>
${items}
  </channel>
</rss>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
};
