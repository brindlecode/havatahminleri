import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

/**
 * The sitemap used to stamp `lastmod: new Date()` on all ~7,356 URLs on every
 * deploy - telling Google that every page on the site, including the legal
 * pages, had just changed. That is not a truthful signal and it gives a
 * crawler no way to prioritise.
 *
 * Forecast pages genuinely do change on every data refresh, so they get the
 * timestamp the forecast was actually fetched from Open-Meteo. Pages whose
 * content does not depend on the forecast (home shell aside, the legal and
 * informational pages) get no lastmod at all rather than an invented one.
 */
function readForecastFetchedAt() {
  try {
    const raw = readFileSync(resolve(process.cwd(), 'src/data/weather-cache.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    const t = new Date(parsed.fetchedAt);
    return Number.isNaN(t.getTime()) ? null : t;
  } catch {
    return null;
  }
}

const forecastFetchedAt = readForecastFetchedAt();

/** Pages that do not change when the forecast data changes. */
const STATIC_PAGES = [
  '/hakkimizda/',
  '/iletisim/',
  '/gizlilik-politikasi/',
  '/cerez-politikasi/',
  '/kullanim-sartlari/',
];

export default defineConfig({
  site: 'https://yarinhava.com',
  trailingSlash: 'always',
  integrations: [
    sitemap({
      // /admin/ is a private tool; the 404 page is not a real URL.
      filter: (page) => !page.includes('/admin/'),
      serialize(item) {
        const path = new URL(item.url).pathname;

        // changefreq and priority are ignored by Google and were set to the
        // same value on every URL anyway, so they carry no information.
        delete item.changefreq;
        delete item.priority;

        if (STATIC_PAGES.includes(path) || !forecastFetchedAt) {
          delete item.lastmod;
          return item;
        }

        item.lastmod = forecastFetchedAt.toISOString();
        return item;
      },
      i18n: {
        defaultLocale: 'tr',
        locales: { tr: 'tr-TR' },
      },
    }),
  ],
  output: 'static',
  build: {
    format: 'directory',
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
