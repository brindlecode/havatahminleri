#!/usr/bin/env node
/**
 * Submit every sitemap URL to IndexNow (Bing, Yandex, Seznam, Naver...).
 *
 * Every location page changes daily with the new forecast, so the whole
 * sitemap is submitted after each successful production deploy.
 *
 * Usage:
 *   node scripts/indexnow.mjs              # read dist/ sitemap, POST
 *   node scripts/indexnow.mjs --live       # read the live sitemap instead
 *   node scripts/indexnow.mjs --dry-run    # print what would be sent
 *
 * Verification: the key is served at https://yarinhava.com/<key>.txt from
 * public/<key>.txt. Exits non-zero (with a ::warning::) on failure; the CI
 * step is continue-on-error, so IndexNow can never fail a deploy.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const HOST = 'yarinhava.com';
const ORIGIN = `https://${HOST}`;
const KEY = process.env.INDEXNOW_KEY ?? '0a03ea18a8a3381dee4461a470dc2d82';
const KEY_LOCATION = `${ORIGIN}/${KEY}.txt`;
const ENDPOINT = 'https://api.indexnow.org/indexnow';
const MAX_URLS_PER_REQUEST = 10_000;
const TIMEOUT_MS = 30_000;

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const LIVE = argv.includes('--live');

export function extractLocs(xml) {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'user-agent': 'yarinhava-indexnow' } });
    if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Load a sitemap (index or urlset) and return every page URL. */
async function collectUrls() {
  const readSitemap = async (url) => {
    if (!LIVE) {
      const file = join(DIST, new URL(url).pathname);
      if (existsSync(file)) return readFileSync(file, 'utf-8');
    }
    return fetchText(url);
  };

  let indexUrl = `${ORIGIN}/sitemap-index.xml`;
  if (!LIVE && !existsSync(join(DIST, 'sitemap-index.xml'))) {
    const any = existsSync(DIST) ? readdirSync(DIST).find((f) => /^sitemap.*\.xml$/.test(f)) : null;
    if (any) indexUrl = `${ORIGIN}/${any}`;
    else console.log('[INDEXNOW] No sitemap in dist/ - using the live sitemap');
  }

  const xml = await readSitemap(indexUrl);
  const urls = [];
  if (/<sitemapindex/.test(xml)) {
    for (const child of extractLocs(xml)) urls.push(...extractLocs(await readSitemap(child)));
  } else {
    urls.push(...extractLocs(xml));
  }
  return [...new Set(urls)].filter((u) => {
    try {
      return new URL(u).host === HOST;
    } catch {
      return false;
    }
  });
}

async function submit(urlList) {
  const body = JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body,
      signal: controller.signal,
    });
    const text = await res.text().catch(() => '');
    // 200 OK and 202 Accepted (key validation pending) are both success.
    if (res.status !== 200 && res.status !== 202) {
      throw new Error(`HTTP ${res.status} ${text.slice(0, 300)}`);
    }
    return res.status;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const keyFile = join(ROOT, 'public', `${KEY}.txt`);
  if (!existsSync(keyFile) || readFileSync(keyFile, 'utf-8').trim() !== KEY) {
    throw new Error(`public/${KEY}.txt is missing or does not contain the key`);
  }

  const urls = await collectUrls();
  if (!urls.length) throw new Error('no URLs found in the sitemap');
  console.log(`[INDEXNOW] ${urls.length} URLs for ${HOST} (key ${KEY_LOCATION})`);

  for (let i = 0; i < urls.length; i += MAX_URLS_PER_REQUEST) {
    const chunk = urls.slice(i, i + MAX_URLS_PER_REQUEST);
    if (DRY_RUN) {
      console.log(`[INDEXNOW] dry run: would POST ${chunk.length} URLs (first: ${chunk[0]})`);
      continue;
    }
    const status = await submit(chunk);
    console.log(`[INDEXNOW] Submitted ${chunk.length} URLs -> HTTP ${status}`);
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    console.log(`::warning::[INDEXNOW] submission failed: ${err.message}`);
    process.exit(1);
  });
}
