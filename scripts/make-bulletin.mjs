#!/usr/bin/env node
/**
 * Freeze today's forecast numbers into src/data/bulletins/<date>.json, the
 * source of that day's bulletin page (/bulten/<d>-<ay>-<yyyy>-hava-durumu/,
 * rendered by src/lib/bulletin.ts).
 *
 * Runs in the build after scripts/fetch-weather.mjs. The first build of the
 * day writes the file; later builds that day leave it alone, so a bulletin
 * keeps the numbers it was published with. The workflow commits the new file
 * back to the repository, which is what keeps old bulletins online after the
 * forecast cache has moved on.
 *
 * Usage:
 *   node scripts/make-bulletin.mjs                  # write today's file if missing
 *   node scripts/make-bulletin.mjs --out <dir>      # write somewhere else
 *   node scripts/make-bulletin.mjs --allow-synthetic --force   # local testing
 *
 * Never fails the build: a missing or partial forecast only means no bulletin
 * today (exit 0 with a ::warning::). When a file is written its path goes to
 * $GITHUB_OUTPUT as `file=<path>`.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DAYS = 7;
/** Below this many provinces with data for today, no bulletin is written. */
const MIN_PROVINCES = 77;

const r1 = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : 0);

export function istanbulToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/**
 * Build the facts object from a weather cache ({ fetchedAt, data }) and
 * provinces.json. Returns { facts } or { skip: reason }.
 */
export function buildFacts(cache, provinces, { now = new Date(), allowSynthetic = false } = {}) {
  if (!cache?.data) return { skip: 'no weather cache' };
  if (cache.synthetic && !allowSynthetic) return { skip: 'weather cache is synthetic' };
  const today = istanbulToday(now);

  const out = [];
  let days = null;
  for (const p of provinces) {
    const w = cache.data[`${p.lat.toFixed(2)}_${p.lon.toFixed(2)}`];
    const d = w?.daily;
    if (!d?.time?.length || d.time[0] !== today) continue;
    const n = Math.min(DAYS, d.time.length);
    if (!days || n > days.length) days = d.time.slice(0, n);
    const tuples = [];
    for (let i = 0; i < n; i++) {
      tuples.push([
        r1(d.temperatureMax[i]),
        r1(d.temperatureMin[i]),
        d.weatherCode[i] ?? 0,
        r1(d.precipitationSum?.[i] ?? 0),
        Math.round(d.precipitationProbabilityMax?.[i] ?? 0),
        r1(d.windSpeedMax?.[i] ?? 0),
      ]);
    }
    out.push({ plate: p.plate, d: tuples });
  }

  if (out.length < MIN_PROVINCES) {
    return { skip: `only ${out.length}/${provinces.length} provinces have a forecast starting ${today}` };
  }
  return {
    facts: {
      version: 1,
      date: today,
      fetchedAt: cache.fetchedAt,
      generatedAt: now.toISOString(),
      days,
      provinces: out.sort((a, b) => a.plate - b.plate),
    },
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i > -1 ? argv[i + 1] : undefined;
  };
  const outDir = arg('--out') ?? join(ROOT, 'src/data/bulletins');
  const force = argv.includes('--force');
  const allowSynthetic = argv.includes('--allow-synthetic');

  let cache;
  try {
    cache = JSON.parse(readFileSync(join(ROOT, 'src/data/weather-cache.json'), 'utf-8'));
  } catch {
    console.log('::warning::make-bulletin: no weather cache - no bulletin today');
    return;
  }
  const provinces = JSON.parse(readFileSync(join(ROOT, 'src/data/provinces.json'), 'utf-8'));

  const res = buildFacts(cache, provinces, { allowSynthetic });
  if (res.skip) {
    console.log(`::warning::make-bulletin: ${res.skip} - no bulletin today`);
    return;
  }
  const file = join(outDir, `${res.facts.date}.json`);
  if (existsSync(file) && !force) {
    console.log(`[BULLETIN] ${relative(ROOT, file)} already exists - keeping the published numbers`);
    return;
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(file, `${JSON.stringify(res.facts)}\n`);
  console.log(`[BULLETIN] wrote ${relative(ROOT, file)} (${res.facts.provinces.length} provinces, ${res.facts.days.length} days)`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `file=${relative(ROOT, file)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
