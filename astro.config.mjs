import { readFileSync, readdirSync, existsSync } from 'node:fs';
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

/**
 * Bulletins (/bulten/<d>-<ay>-<yyyy>-hava-durumu/) never change after they
 * are published, so each carries its publication time; the archive page
 * carries the newest one. Same slug rule as src/lib/bulletin.ts.
 */
const MONTH_SLUGS = ['ocak', 'subat', 'mart', 'nisan', 'mayis', 'haziran', 'temmuz', 'agustos', 'eylul', 'ekim', 'kasim', 'aralik'];
function readBulletinDates() {
  const dir = resolve(process.cwd(), 'src/data/bulletins');
  const out = new Map();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((x) => /^\d{4}-\d{2}-\d{2}\.json$/.test(x))) {
    try {
      const facts = JSON.parse(readFileSync(resolve(dir, f), 'utf-8'));
      const [y, m, d] = facts.date.split('-').map(Number);
      const t = new Date(facts.generatedAt);
      if (!Number.isNaN(t.getTime())) out.set(`/bulten/${d}-${MONTH_SLUGS[m - 1]}-${y}-hava-durumu/`, t);
    } catch {
      // An unreadable file is skipped by the page too.
    }
  }
  return out;
}
const bulletinDates = readBulletinDates();
const latestBulletin = [...bulletinDates.values()].sort((a, b) => b - a)[0] ?? null;

/** Climate pages change only when climate.json is regenerated. */
function readClimateUpdatedAt() {
  try {
    const t = new Date(JSON.parse(readFileSync(resolve(process.cwd(), 'src/data/climate.json'), 'utf-8')).updatedAt);
    return Number.isNaN(t.getTime()) ? null : t;
  } catch {
    return null;
  }
}
const climateUpdatedAt = readClimateUpdatedAt();

/** Pages that do not change when the forecast data changes. */
const STATIC_PAGES = [
  '/hakkimizda/',
  '/iletisim/',
  '/gizlilik-politikasi/',
  '/cerez-politikasi/',
  '/kullanim-sartlari/',
  '/hava-durumu-simgeleri/',
];

export default defineConfig({
  site: 'https://yarinhava.com',
  trailingSlash: 'always',
  integrations: [
    sitemap({
      // /admin/ is a private tool; the 404 page is not a real URL. The
      // bulletin archive is listed only once a bulletin exists.
      filter: (page) => !page.includes('/admin/') && (latestBulletin !== null || !page.endsWith('/bulten/')),
      serialize(item) {
        const path = new URL(item.url).pathname;

        // changefreq and priority are ignored by Google and were set to the
        // same value on every URL anyway, so they carry no information.
        delete item.changefreq;
        delete item.priority;

        if (path.startsWith('/bulten/')) {
          const t = path === '/bulten/' ? latestBulletin : bulletinDates.get(path);
          if (t) item.lastmod = t.toISOString();
          else delete item.lastmod;
          return item;
        }

        if (path.includes('/iklim/')) {
          if (climateUpdatedAt) item.lastmod = climateUpdatedAt.toISOString();
          else delete item.lastmod;
          return item;
        }

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
