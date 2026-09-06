#!/usr/bin/env node
/**
 * Post-deploy smoke test / standalone health check against the live site.
 *
 * Run after a production deploy (to confirm the new build is actually serving)
 * and on a schedule (to catch a deploy pipeline that has silently stopped
 * running - the failure mode that cost the site ~75% of its organic traffic
 * between July and August 2026).
 *
 * Usage:
 *   node scripts/smoke-test.mjs                       # https://yarinhava.com
 *   node scripts/smoke-test.mjs --base https://...     # a Netlify preview
 *   node scripts/smoke-test.mjs --max-age-hours 30
 *
 * Exits non-zero on any failure, and prints one line per check so a CI log
 * shows exactly what broke.
 */

const argv = process.argv.slice(2);
function flag(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? argv[i + 1] : fallback;
}

const BASE = (flag('base', 'https://yarinhava.com')).replace(/\/$/, '');
const MAX_AGE_HOURS = Number(flag('max-age-hours', '26'));
const TIMEZONE = 'Europe/Istanbul';
const TIMEOUT_MS = 20000;

const failures = [];
const passes = [];

function pass(msg) { passes.push(msg); console.log(`  ok   ${msg}`); }
function fail(msg) { failures.push(msg); console.log(`  FAIL ${msg}`); }

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

async function get(path, { redirect = 'manual' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, {
      redirect,
      signal: controller.signal,
      headers: { 'user-agent': 'yarinhava-smoke-test' },
    });
    const body = res.status < 400 && res.status >= 200 ? await res.text() : '';
    return { status: res.status, location: res.headers.get('location'), body, headers: res.headers };
  } finally {
    clearTimeout(timer);
  }
}

const TODAY = todayInIstanbul();
const TOMORROW = addDays(TODAY, 1);

/** Cities spread across regions, plus the district slugs GSC flagged. */
const SAMPLE_PAGES = [
  { path: '/', kind: 'home' },
  { path: '/kocaeli-hava-durumu/', kind: 'base' },
  { path: '/kocaeli-hava-durumu/15-gunluk/', kind: '15gun' },
  { path: '/bartin-hava-durumu/15-gunluk/', kind: '15gun' },
  { path: '/adiyaman-hava-durumu/15-gunluk/', kind: '15gun' },
  { path: '/istanbul-hava-durumu/bugun/', kind: 'bugun' },
  { path: '/ankara-hava-durumu/7-gunluk/', kind: '7gun' },
  { path: '/izmir-hava-durumu/saatlik/', kind: 'saatlik' },
  { path: '/erzurum-hava-durumu/10-gunluk/', kind: '10gun' },
  { path: '/hatay/i-skenderun-hava-durumu/', kind: 'base' },
  { path: '/kocaeli/i-zmit-hava-durumu/15-gunluk/', kind: '15gun' },
  { path: '/zonguldak/eregli-zonguldak-hava-durumu/', kind: 'base' },
];

const EXPECTED_ROWS = { base: 1, bugun: 1, yarin: 1, '7gun': 7, '10gun': 10, '15gun': 15, saatlik: 0 };

console.log(`Smoke test against ${BASE} (today in ${TIMEZONE}: ${TODAY})\n`);

// --- 1. infrastructure -------------------------------------------------------

console.log('robots.txt and sitemap');
try {
  const robots = await get('/robots.txt', { redirect: 'follow' });
  if (robots.status !== 200) fail(`robots.txt returned ${robots.status}`);
  else if (!robots.body.includes('sitemap-index.xml')) fail('robots.txt does not reference the sitemap index');
  else if (/^\s*Disallow:\s*\/\s*$/m.test(robots.body)) fail('robots.txt blocks the whole site');
  else pass('robots.txt is served and allows crawling');
} catch (err) {
  fail(`robots.txt request failed: ${err.message}`);
}

let sitemapUrlCount = 0;
try {
  const index = await get('/sitemap-index.xml', { redirect: 'follow' });
  if (index.status !== 200) {
    fail(`sitemap-index.xml returned ${index.status}`);
  } else {
    const shards = [...index.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    for (const shard of shards) {
      const res = await get(new URL(shard).pathname, { redirect: 'follow' });
      if (res.status !== 200) { fail(`sitemap shard ${shard} returned ${res.status}`); continue; }
      sitemapUrlCount += (res.body.match(/<loc>/g) ?? []).length;
    }
    if (sitemapUrlCount < 7000) fail(`sitemap lists only ${sitemapUrlCount} URLs - expected ~7,300`);
    else pass(`sitemap lists ${sitemapUrlCount} URLs across ${shards.length} shard(s)`);
  }
} catch (err) {
  fail(`sitemap request failed: ${err.message}`);
}

// --- 2. URL canonicalisation -------------------------------------------------

console.log('\nURL canonicalisation');
const CANON_CASES = [
  { from: '/kocaeli-hava-durumu/15-gunluk', to: '/kocaeli-hava-durumu/15-gunluk/', why: 'missing trailing slash' },
  { from: '/kocaeli-hava-durumu', to: '/kocaeli-hava-durumu/', why: 'missing trailing slash' },
];
for (const c of CANON_CASES) {
  try {
    const res = await get(c.from);
    if (res.status === 301 || res.status === 308) {
      const target = res.location ? new URL(res.location, BASE).pathname : '';
      if (target === c.to) pass(`${c.from} -> 301 -> ${c.to}`);
      else fail(`${c.from} redirects to ${target}, expected ${c.to}`);
    } else if (res.status === 200) {
      fail(`${c.from} returns 200 - duplicate of ${c.to} (${c.why})`);
    } else {
      fail(`${c.from} returned ${res.status}`);
    }
  } catch (err) {
    fail(`${c.from} request failed: ${err.message}`);
  }
}

// --- 3. pages ----------------------------------------------------------------

console.log('\nPages');
for (const page of SAMPLE_PAGES) {
  let res;
  try {
    res = await get(page.path, { redirect: 'follow' });
  } catch (err) {
    fail(`${page.path} request failed: ${err.message}`);
    continue;
  }

  if (res.status !== 200) { fail(`${page.path} returned ${res.status}`); continue; }
  const html = res.body;

  const canonical = html.match(/<link rel="canonical" href="([^"]*)"/)?.[1];
  if (canonical !== `https://yarinhava.com${page.path}`) {
    fail(`${page.path} canonical is ${canonical}`);
    continue;
  }

  if (/<meta name="robots"[^>]*noindex/i.test(html)) { fail(`${page.path} is noindex`); continue; }

  const h1s = (html.match(/<h1[\s>]/g) ?? []).length;
  if (h1s !== 1) { fail(`${page.path} has ${h1s} <h1> elements`); continue; }

  if (page.kind === 'home') { pass(`${page.path} 200, canonical, single H1`); continue; }

  // The check that matters: is the forecast on the page actually current?
  const dates = [...html.matchAll(/data-date="([^"]+)"/g)].map((m) => m[1]);
  const expectedRows = EXPECTED_ROWS[page.kind];
  if (dates.length !== expectedRows) {
    fail(`${page.path} shows ${dates.length} forecast days, expected ${expectedRows}`);
    continue;
  }
  const firstExpected = page.kind === 'base' || page.kind === 'yarin' ? TOMORROW : TODAY;
  if (dates.length && dates[0] !== firstExpected) {
    fail(`${page.path} STALE: first forecast row is ${dates[0]}, expected ${firstExpected}`);
    continue;
  }

  const freshness = html.match(/<time datetime="([^"]+)"/)?.[1];
  if (!freshness) { fail(`${page.path} has no "Son güncelleme" timestamp`); continue; }
  const ageHours = (Date.now() - new Date(freshness).getTime()) / 3_600_000;
  if (!(ageHours < MAX_AGE_HOURS)) {
    fail(`${page.path} STALE: forecast data is ${ageHours.toFixed(1)}h old (limit ${MAX_AGE_HOURS}h)`);
    continue;
  }

  // Third-party scripts we depend on for revenue and measurement.
  const missing = [];
  if (!html.includes('googletagmanager.com/gtag/js')) missing.push('GA4');
  if (!html.includes('pagead2.googlesyndication.com')) missing.push('AdSense');
  if (missing.length) {
    fail(`${page.path} is missing ${missing.join(' and ')} script tag(s)`);
    continue;
  }

  pass(`${page.path} 200, current (${dates[0] ?? 'hourly'}), data ${ageHours.toFixed(1)}h old, ${expectedRows} rows`);
}

// --- 4. 404 ------------------------------------------------------------------

console.log('\nError handling');
try {
  const res = await get('/bu-sayfa-yok-12345/', { redirect: 'follow' });
  if (res.status === 404) pass('unknown URLs return 404');
  else fail(`unknown URL returned ${res.status}, expected 404`);
} catch (err) {
  fail(`404 check failed: ${err.message}`);
}

// --- report ------------------------------------------------------------------

console.log(`\n${passes.length} passed, ${failures.length} failed.`);
if (failures.length) {
  console.error('\nFAILURES:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('Production looks healthy.');
