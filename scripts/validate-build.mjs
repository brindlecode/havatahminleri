#!/usr/bin/env node
/**
 * Pre-deploy gate.
 *
 * Runs against dist/ after `astro build` and BEFORE the Netlify upload. If any
 * check fails the process exits non-zero, the deploy step is skipped and the
 * previous good production build stays live.
 *
 * This exists because of the July-August 2026 incident: the site served
 * five-week-old forecasts labelled "Bugün" for over a month and nothing in the
 * pipeline noticed. Every check below is a thing that was silently wrong then,
 * or a thing that would be silently wrong now if a template regressed.
 *
 * Usage: node scripts/validate-build.mjs [--dist dist] [--allow-synthetic]
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const argv = process.argv.slice(2);
const distFlag = argv.indexOf('--dist');
const DIST = join(ROOT, distFlag > -1 ? argv[distFlag + 1] : 'dist');
const ALLOW_SYNTHETIC = argv.includes('--allow-synthetic');

const ORIGIN = 'https://yarinhava.com';
const TIMEZONE = 'Europe/Istanbul';
const PERIOD_SLUGS = ['bugun', 'yarin', '7-gunluk', '10-gunluk', '15-gunluk', 'saatlik'];
const EXPECTED_DAY_ROWS = {
  '': 1, bugun: 1, yarin: 1, '7-gunluk': 7, '10-gunluk': 10, '15-gunluk': 15, saatlik: 0,
};

const failures = [];
const warnings = [];
const notes = [];

const fail = (msg) => failures.push(msg);
const warn = (msg) => warnings.push(msg);
const note = (msg) => notes.push(msg);

function todayInIstanbul() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function read(path) {
  return readFileSync(path, 'utf-8');
}

function firstMatch(html, re) {
  const m = html.match(re);
  return m ? m[1] : null;
}

function countMatches(html, re) {
  return (html.match(re) ?? []).length;
}

// --- 0. the data behind the build -------------------------------------------

const TODAY = todayInIstanbul();
console.log(`[VALIDATE] Today in ${TIMEZONE}: ${TODAY}`);

const cachePath = join(ROOT, 'src/data/weather-cache.json');
if (!existsSync(cachePath)) {
  fail('src/data/weather-cache.json is missing - the build has no forecast data');
} else {
  const cache = JSON.parse(read(cachePath));
  const ageHours = (Date.now() - new Date(cache.fetchedAt).getTime()) / 3_600_000;
  note(`Forecast cache: ${Object.keys(cache.data ?? {}).length} locations, fetched ${cache.fetchedAt} (${ageHours.toFixed(1)}h ago)`);

  if (cache.synthetic) {
    const msg = 'weather-cache.json is SYNTHETIC fixture data (scripts/make-fixture-cache.mjs)';
    ALLOW_SYNTHETIC ? warn(msg) : fail(`${msg} - refusing to validate as deployable`);
  }
  if (!(ageHours < 24)) {
    fail(`Forecast data is ${ageHours.toFixed(1)}h old - a deploy would publish outdated forecasts`);
  }

  // Every cached entry must start today, or a page will label a past date "Bugün".
  const notToday = Object.entries(cache.data ?? {}).filter(([, v]) => v?.daily?.time?.[0] !== TODAY);
  if (notToday.length) {
    fail(`${notToday.length} cached locations do not start on ${TODAY} (e.g. ${notToday[0][0]} starts ${notToday[0][1]?.daily?.time?.[0]})`);
  }
}

// --- 1. what got built -------------------------------------------------------

if (!existsSync(DIST)) {
  console.error(`[VALIDATE] FATAL: ${DIST} does not exist. Run astro build first.`);
  process.exit(1);
}

const provinces = JSON.parse(read(join(ROOT, 'src/data/provinces.json')));
const districts = JSON.parse(read(join(ROOT, 'src/data/districts.json')));

const htmlFiles = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (entry.name.endsWith('.html')) htmlFiles.push(p);
  }
})(DIST);

const builtPaths = new Set(
  htmlFiles.map((f) => '/' + relative(DIST, f).replace(/index\.html$/, '').replace(/\\/g, '/')),
);

// 1 home + 5 legal + 404 + admin + (81 + 969) x (1 base + 6 periods)
const expectedLocationPages = (provinces.length + districts.length) * 7;
const expectedTotal = expectedLocationPages + 8;

note(`Built ${htmlFiles.length} HTML files (expected ${expectedTotal})`);
if (htmlFiles.length < expectedTotal) {
  fail(`Only ${htmlFiles.length} pages built, expected ${expectedTotal} - pages are missing`);
} else if (htmlFiles.length > expectedTotal) {
  warn(`${htmlFiles.length} pages built, expected ${expectedTotal} - new routes were added`);
}

// Every location must have all 7 templates.
const missing = [];
for (const p of provinces) {
  const base = `/${p.slug}-hava-durumu/`;
  if (!builtPaths.has(base)) missing.push(base);
  for (const s of PERIOD_SLUGS) if (!builtPaths.has(`${base}${s}/`)) missing.push(`${base}${s}/`);
}
for (const d of districts) {
  const base = `/${d.province}/${d.slug}-hava-durumu/`;
  if (!builtPaths.has(base)) missing.push(base);
  for (const s of PERIOD_SLUGS) if (!builtPaths.has(`${base}${s}/`)) missing.push(`${base}${s}/`);
}
if (missing.length) {
  fail(`${missing.length} expected location pages were not built (e.g. ${missing.slice(0, 3).join(', ')})`);
}

// --- 2. sitemap --------------------------------------------------------------

const sitemapIndex = join(DIST, 'sitemap-index.xml');
if (!existsSync(sitemapIndex)) {
  fail('dist/sitemap-index.xml is missing');
} else {
  const shards = [...read(sitemapIndex).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const locs = [];
  const lastmods = new Set();

  for (const shardUrl of shards) {
    const file = join(DIST, new URL(shardUrl).pathname);
    if (!existsSync(file)) {
      fail(`Sitemap shard ${shardUrl} is referenced but not built`);
      continue;
    }
    const xml = read(file);
    for (const m of xml.matchAll(/<url>(.*?)<\/url>/gs)) {
      const entry = m[1];
      const loc = firstMatch(entry, /<loc>([^<]+)<\/loc>/);
      const lastmod = firstMatch(entry, /<lastmod>([^<]+)<\/lastmod>/);
      if (loc) locs.push(loc);
      if (lastmod) lastmods.add(lastmod);
    }
  }

  note(`Sitemap: ${locs.length} URLs across ${shards.length} shard(s), ${lastmods.size} distinct lastmod value(s)`);

  const dupes = locs.filter((l, i) => locs.indexOf(l) !== i);
  if (dupes.length) fail(`Sitemap contains ${dupes.length} duplicate URLs (e.g. ${dupes[0]})`);

  for (const loc of locs) {
    if (!loc.startsWith(`${ORIGIN}/`)) { fail(`Sitemap URL is not on the canonical origin: ${loc}`); break; }
  }
  const noSlash = locs.filter((l) => !l.endsWith('/'));
  if (noSlash.length) fail(`${noSlash.length} sitemap URLs lack a trailing slash (e.g. ${noSlash[0]})`);

  const admin = locs.filter((l) => l.includes('/admin/'));
  if (admin.length) fail(`Sitemap exposes ${admin.length} admin URLs`);

  const notBuilt = locs.filter((l) => !builtPaths.has(new URL(l).pathname));
  if (notBuilt.length) {
    fail(`${notBuilt.length} sitemap URLs have no corresponding page (e.g. ${notBuilt[0]})`);
  }

  if (locs.length < expectedLocationPages) {
    fail(`Sitemap has ${locs.length} URLs, fewer than the ${expectedLocationPages} location pages built`);
  }

  // The old config stamped `new Date()` on every URL on every deploy.
  for (const lm of lastmods) {
    if (Number.isNaN(new Date(lm).getTime())) fail(`Sitemap lastmod is not a valid date: ${lm}`);
  }
}

// --- 3. per-page HTML checks -------------------------------------------------

/** Representative sample: big/small provinces, big/small districts, all periods. */
const SAMPLE_LOCATIONS = [
  { province: 'istanbul' },
  { province: 'ankara' },
  { province: 'izmir' },
  { province: 'kocaeli' },
  { province: 'bartin' },
  { province: 'adiyaman' },
  { province: 'zonguldak' },
  { province: 'kocaeli', district: 'i-zmit' },
  { province: 'bursa', district: 'i-negol' },
  { province: 'hatay', district: 'i-skenderun' },
  { province: 'zonguldak', district: 'eregli-zonguldak' },
  { province: 'adiyaman', district: 'adiyaman-merkez' },
  { province: 'istanbul', district: 'sisli' },
];

function locationBase(loc) {
  return loc.district ? `/${loc.province}/${loc.district}-hava-durumu/` : `/${loc.province}-hava-durumu/`;
}

function checkPage(path, { periodSlug }) {
  const file = join(DIST, path, 'index.html');
  if (!existsSync(file)) {
    fail(`Sample page not built: ${path}`);
    return;
  }
  const html = read(file);
  const label = path;

  // -- head
  const title = firstMatch(html, /<title>([^<]*)<\/title>/);
  if (!title || !title.trim()) fail(`${label}: empty <title>`);
  else if (title.length > 75) warn(`${label}: title is ${title.length} chars - "${title}"`);

  const desc = firstMatch(html, /<meta name="description" content="([^"]*)"/);
  if (!desc) fail(`${label}: no meta description`);
  else if (desc.length < 80 || desc.length > 165) {
    warn(`${label}: meta description is ${desc.length} chars`);
  }

  const canonical = firstMatch(html, /<link rel="canonical" href="([^"]*)"/);
  const expectedCanonical = `${ORIGIN}${path}`;
  if (!canonical) fail(`${label}: no canonical link`);
  else if (canonical !== expectedCanonical) fail(`${label}: canonical is ${canonical}, expected ${expectedCanonical}`);
  if (countMatches(html, /<link rel="canonical"/g) !== 1) fail(`${label}: more than one canonical link`);

  const robots = firstMatch(html, /<meta name="robots" content="([^"]*)"/);
  if (robots && /noindex/i.test(robots)) fail(`${label}: page is noindex ("${robots}")`);

  // -- headings
  const h1s = countMatches(html, /<h1[\s>]/g);
  if (h1s !== 1) fail(`${label}: ${h1s} <h1> elements, expected exactly 1`);
  if (countMatches(html, /<h2[\s>]/g) < 2) warn(`${label}: fewer than 2 <h2> sections`);

  // -- structured data
  const ldBlocks = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => m[1]);
  if (!ldBlocks.length) fail(`${label}: no JSON-LD`);
  for (const block of ldBlocks) {
    try {
      const parsed = JSON.parse(block);
      if (parsed['@type'] === 'WebPage') {
        if (!parsed.dateModified) fail(`${label}: WebPage JSON-LD has no dateModified`);
        else if (!parsed.dateModified.startsWith(TODAY) && !parsed.dateModified.startsWith(addDays(TODAY, -1))) {
          fail(`${label}: JSON-LD dateModified is ${parsed.dateModified}, not today's data`);
        }
        if (parsed.url !== expectedCanonical) fail(`${label}: JSON-LD url ${parsed.url} != canonical`);
      }
      if (parsed['@type'] === 'BreadcrumbList') {
        for (const item of parsed.itemListElement) {
          if (!String(item.item).startsWith('https://')) {
            fail(`${label}: breadcrumb item is not an absolute URL: ${item.item}`);
          }
        }
      }
    } catch (err) {
      fail(`${label}: invalid JSON-LD (${err.message})`);
    }
  }

  // -- freshness signal
  const freshness = firstMatch(html, /<time datetime="([^"]+)"/);
  if (!freshness) fail(`${label}: no visible "Son güncelleme" timestamp`);
  else {
    const age = (Date.now() - new Date(freshness).getTime()) / 3_600_000;
    if (!(age < 24)) fail(`${label}: rendered freshness timestamp is ${age.toFixed(1)}h old`);
  }

  // -- forecast content is in the static HTML, and it is current
  const dates = [...html.matchAll(/data-date="([^"]+)"/g)].map((m) => m[1]);
  const expectedRows = EXPECTED_DAY_ROWS[periodSlug];
  if (dates.length !== expectedRows) {
    fail(`${label}: ${dates.length} forecast day rows, expected ${expectedRows}`);
  }
  const firstExpected = periodSlug === '' || periodSlug === 'yarin' ? addDays(TODAY, 1) : TODAY;
  if (dates.length && dates[0] !== firstExpected) {
    fail(`${label}: first forecast row is ${dates[0]}, expected ${firstExpected} - STALE CONTENT`);
  }
  for (const d of dates) {
    if (d < TODAY) fail(`${label}: forecast row for a past date: ${d}`);
  }

  const hours = [...html.matchAll(/data-time="([^"]+)"/g)].map((m) => m[1]);
  for (const h of hours) {
    if (h.slice(0, 10) < TODAY) fail(`${label}: hourly cell for a past date: ${h}`);
  }
  if (['', 'bugun', 'yarin', 'saatlik'].includes(periodSlug) && hours.length === 0) {
    fail(`${label}: hourly strip is empty`);
  }

  // -- period navigation points at real, canonical URLs
  const hrefs = [...html.matchAll(/href="(\/[^"#?]*)"/g)].map((m) => m[1]);
  for (const href of new Set(hrefs)) {
    if (!href.endsWith('/') && !/\.[a-z0-9]+$/i.test(href)) {
      fail(`${label}: internal link without a trailing slash: ${href}`);
    }
    if (href.endsWith('/') && !builtPaths.has(href)) {
      fail(`${label}: internal link to a page that was not built: ${href}`);
    }
  }

  // -- an empty component would mean a data hole
  if (/<section[^>]*>\s*<\/section>/.test(html)) warn(`${label}: contains an empty <section>`);
}

for (const loc of SAMPLE_LOCATIONS) {
  const base = locationBase(loc);
  if (!builtPaths.has(base)) {
    fail(`Sample location was not built: ${base}`);
    continue;
  }
  checkPage(base, { periodSlug: '' });
  for (const slug of PERIOD_SLUGS) {
    checkPage(`${base}${slug}/`, { periodSlug: slug });
  }
}

// --- 4. robots + admin -------------------------------------------------------

const robotsPath = join(DIST, 'robots.txt');
if (!existsSync(robotsPath)) {
  fail('dist/robots.txt is missing');
} else {
  const robots = read(robotsPath);
  if (!robots.includes(`Sitemap: ${ORIGIN}/sitemap-index.xml`)) fail('robots.txt does not point at the sitemap index');
  if (!/Disallow:\s*\/admin\//.test(robots)) fail('robots.txt does not disallow /admin/');
  for (const agent of ['Googlebot', 'Mediapartners-Google', 'AdsBot-Google']) {
    if (!robots.includes(agent)) warn(`robots.txt has no explicit ${agent} group`);
  }
  if (/^\s*Disallow:\s*\/\s*$/m.test(robots)) fail('robots.txt blocks the whole site');
}

const adminIndex = join(DIST, 'admin', 'index.html');
if (existsSync(adminIndex)) {
  const html = read(adminIndex);
  if (!/name="robots"[^>]*noindex/i.test(html)) {
    warn('/admin/ is built and only protected by robots.txt - it has no noindex meta tag');
  }
}

// --- report ------------------------------------------------------------------

console.log('');
for (const n of notes) console.log(`[VALIDATE] ${n}`);
console.log('');
for (const w of warnings) console.log(`[VALIDATE] WARN  ${w}`);
if (warnings.length) console.log('');

if (failures.length) {
  for (const f of failures) console.error(`[VALIDATE] FAIL  ${f}`);
  console.error(`\n[VALIDATE] ${failures.length} blocking problem(s). NOT deploying; the previous build stays live.`);
  process.exit(1);
}

console.log(`[VALIDATE] OK - ${htmlFiles.length} pages passed ${warnings.length ? `with ${warnings.length} warning(s)` : 'with no warnings'}.`);
