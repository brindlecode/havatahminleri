#!/usr/bin/env node
/**
 * Replaces the district coordinates in src/data/districts.json with real ones
 * from GeoNames (https://www.geonames.org, CC BY 4.0).
 *
 * Why: the original generator (scripts/gen.cjs, now deleted) placed every
 * district at a RANDOM point up to ~28 km from its province centre
 * (`prov.lat + (Math.random() - 0.5) * 0.5`). District pages therefore showed
 * the weather of an arbitrary spot - Alanya's forecast came from near Antalya
 * city, ~135 km away.
 *
 * Method, per district (province is always matched first, via admin1 code):
 *   1. find the GeoNames second-order division (ADM2) with the same name;
 *   2. use the seat town of that division (PPLA2 / PPLA with the same admin2
 *      code) - the place people mean by "İlçe X hava durumu";
 *   3. otherwise use the ADM2 point itself;
 *   4. otherwise a populated place (PPLA2/PPLA/PPL) with the same name in the
 *      province;
 *   5. "Merkez" districts use the province capital.
 * Province centres further than 5 km from their GeoNames capital are moved
 * onto it (provinces.json).
 * Any candidate further than 250 km from the province centre is rejected.
 * Districts that cannot be matched keep the province centre (never a random
 * point) and are listed in the report for a manual look.
 *
 * Inputs (download from https://download.geonames.org/export/dump/):
 *   TR.txt, admin1CodesASCII.txt
 * Usage: node scripts/geocode-districts.mjs <dir-with-geonames-files> [--report file]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, '..', 'src', 'data');
const GEO_DIR = process.argv[2];
const reportFlag = process.argv.indexOf('--report');
const REPORT = reportFlag > -1 ? process.argv[reportFlag + 1] : null;
if (!GEO_DIR) {
  console.error('usage: node scripts/geocode-districts.mjs <geonames-dir> [--report file]');
  process.exit(1);
}

const MAX_KM = 250; // Konya, Mersin, Antalya: seats up to ~220 km from the capital

function fold(s) {
  return String(s)
    .replace(/İ/g, 'i').replace(/I/g, 'ı')
    .toLocaleLowerCase('tr-TR')
    .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o')
    .replace(/ş/g, 's').replace(/ü/g, 'u').replace(/â/g, 'a').replace(/î/g, 'i').replace(/û/g, 'u')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function km(aLat, aLon, bLat, bLon) {
  const r = Math.PI / 180;
  const dLat = (bLat - aLat) * r;
  const dLon = (bLon - aLon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

const round4 = (n) => Math.round(n * 10000) / 10000;

// Hand-checked fixes where GeoNames' codes send the matcher to the wrong place
// (Cide's ADM2 seat resolves to Kastamonu city). Town centres.
const OVERRIDES = {
  'kastamonu/cide': [41.8892, 33.0047],
};

const provinces = JSON.parse(readFileSync(join(DATA, 'provinces.json'), 'utf-8'));
const districts = JSON.parse(readFileSync(join(DATA, 'districts.json'), 'utf-8'));

// --- GeoNames ----------------------------------------------------------------

// admin1: "TR.07\tAntalya\tAntalya\t323776"
const admin1ByProvince = new Map();
for (const line of readFileSync(join(GEO_DIR, 'admin1CodesASCII.txt'), 'utf-8').split('\n')) {
  if (!line.startsWith('TR.')) continue;
  const [code, name, ascii] = line.split('\t');
  const a1 = code.slice(3);
  for (const n of [name, ascii]) admin1ByProvince.set(fold(n), a1);
}
// GeoNames spells a few provinces differently from our data.
const PROVINCE_ALIASES = { afyonkarahisar: ['afyon'], kahramanmaras: ['maras'], sanliurfa: ['urfa'], icel: ['mersin'], mersin: ['icel'] };

const rows = [];
for (const line of readFileSync(join(GEO_DIR, 'TR.txt'), 'utf-8').split('\n')) {
  if (!line) continue;
  const c = line.split('\t');
  const fclass = c[6];
  const fcode = c[7];
  if (fclass !== 'A' && fclass !== 'P') continue;
  if (fclass === 'A' && fcode !== 'ADM2') continue;
  if (fclass === 'P' && !['PPLC', 'PPLA', 'PPLA2', 'PPL', 'PPLX'].includes(fcode)) continue;
  const names = new Set([c[1], c[2], ...c[3].split(',')].filter(Boolean).map(fold));
  rows.push({
    name: c[1], names, lat: Number(c[4]), lon: Number(c[5]), fcode,
    admin1: c[10], admin2: c[11], population: Number(c[14] || 0),
  });
}
console.log(`[GEO] ${rows.length} GeoNames rows loaded`);

function provinceAdmin1(p) {
  for (const key of [fold(p.name), fold(p.slug), ...(PROVINCE_ALIASES[fold(p.slug)] ?? [])]) {
    if (admin1ByProvince.has(key)) return admin1ByProvince.get(key);
  }
  // Fall back to the admin1 of the province capital row.
  const cap = rows.find((r) => (r.fcode === 'PPLA' || r.fcode === 'PPLC') && r.names.has(fold(p.name)));
  return cap?.admin1 ?? null;
}

// --- matching ----------------------------------------------------------------

const provBySlug = new Map(provinces.map((p) => [p.slug, p]));
const report = { byMethod: {}, unmatched: [], moved: [], provinceCheck: [] };

for (const p of provinces) {
  const a1 = provinceAdmin1(p);
  p._a1 = a1;
  const cap = rows
    .filter((r) => r.admin1 === a1 && (r.fcode === 'PPLA' || r.fcode === 'PPLC'))
    .sort((a, b) => b.population - a.population)[0];
  p._capital = cap ?? null;
  if (!a1) report.provinceCheck.push(`${p.name}: no GeoNames admin1 match`);
  else if (cap) {
    const d = km(p.lat, p.lon, cap.lat, cap.lon);
    // Province pages show the capital city's weather; move the point onto it
    // when it is off by more than 5 km.
    if (d > 5) {
      report.provinceCheck.push(`${p.name}: moved ${d.toFixed(1)} km onto GeoNames capital ${cap.name} (${cap.lat}, ${cap.lon})`);
      p.lat = round4(cap.lat);
      p.lon = round4(cap.lon);
    }
  }
}

function pick(candidates, p) {
  return candidates
    .filter((r) => km(p.lat, p.lon, r.lat, r.lon) <= MAX_KM)
    .sort((a, b) => b.population - a.population)[0];
}

for (const d of districts) {
  const p = provBySlug.get(d.province);
  const a1 = p?._a1;
  const baseName = d.name.replace(/\s*\(.*\)$/, '');
  const key = fold(baseName);
  let hit = null;
  let method = 'unmatched';

  if (a1) {
    const inProv = rows.filter((r) => r.admin1 === a1);
    if (key === 'merkez' || key === `${fold(p.name)}merkez`) {
      if (p._capital) { hit = p._capital; method = 'merkez: province capital'; }
    }
    if (!hit) {
      const adm2 = pick(inProv.filter((r) => r.fcode === 'ADM2' && r.names.has(key)), p)
        ?? pick(inProv.filter((r) => r.fcode === 'ADM2' && [...r.names].some((n) => n === `${key}ilcesi` || n === `${key}merkez`)), p);
      if (adm2) {
        // An empty admin2 code would match every unassigned row in the
        // province (usually the capital), so only trust a real code.
        const seat = adm2.admin2
          ? pick(inProv.filter((r) => r.admin2 === adm2.admin2 && ['PPLA2', 'PPLA', 'PPLC'].includes(r.fcode)), p)
          : null;
        const namesake = inProv
          .filter((r) => r.fcode.startsWith('PPL') && r.names.has(key) && km(adm2.lat, adm2.lon, r.lat, r.lon) <= 60)
          .sort((a, b) => b.population - a.population)[0];
        if (seat) { hit = seat; method = 'ADM2 seat town'; }
        else if (namesake) { hit = namesake; method = `ADM2 namesake town (${namesake.fcode})`; }
        else { hit = adm2; method = 'ADM2 point'; }
      }
    }
    if (!hit) {
      const place = pick(inProv.filter((r) => ['PPLA2', 'PPLA', 'PPLC'].includes(r.fcode) && r.names.has(key)), p)
        ?? pick(inProv.filter((r) => ['PPL', 'PPLX'].includes(r.fcode) && r.names.has(key)), p);
      if (place) { hit = place; method = `named place (${place.fcode})`; }
    }
  }

  const override = OVERRIDES[`${d.province}/${d.slug}`];
  if (override) {
    hit = { lat: override[0], lon: override[1] };
    method = 'manual override';
  }

  const oldLat = d.lat;
  const oldLon = d.lon;
  if (hit) {
    d.lat = round4(hit.lat);
    d.lon = round4(hit.lon);
  } else {
    // Never keep the random coordinate: the province centre is at least honest.
    d.lat = p.lat;
    d.lon = p.lon;
    report.unmatched.push(`${d.name} (${p?.name ?? d.province})`);
  }
  report.byMethod[method] = (report.byMethod[method] ?? 0) + 1;
  const moved = km(oldLat, oldLon, d.lat, d.lon);
  report.moved.push({ name: `${d.name} (${p?.name})`, km: moved, method });
}

// Two districts must never share a forecast cache key (lat/lon to 2 dp).
const keys = new Map();
const collisions = [];
for (const d of districts) {
  const k = `${d.lat.toFixed(2)}_${d.lon.toFixed(2)}`;
  if (keys.has(k)) collisions.push(`${d.name} (${d.province}) = ${keys.get(k)}`);
  else keys.set(k, `${d.name} (${d.province})`);
}

// A large miss rate means the input or the matching is wrong - write nothing.
if (report.unmatched.length > districts.length * 0.1) {
  console.error(`[GEO] ${report.unmatched.length} districts unmatched - refusing to write districts.json`);
  console.error(report.unmatched.slice(0, 50).join('\n'));
  process.exit(1);
}
writeFileSync(join(DATA, 'districts.json'), JSON.stringify(districts, null, 2) + '\n');
const cleanProvinces = provinces.map(({ _a1, _capital, ...rest }) => rest);
// Keep the file's one-province-per-line layout so the diff stays readable.
const line = (o) => `  { ${Object.entries(o).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')} }`;
writeFileSync(join(DATA, 'provinces.json'), `[\n${cleanProvinces.map(line).join(',\n')}\n]\n`);

// --- report ------------------------------------------------------------------

const moved = report.moved.sort((a, b) => b.km - a.km);
const lines = [
  '# District coordinates - GeoNames regeneration report',
  '',
  `Generated by \`scripts/geocode-districts.mjs\` from GeoNames TR dump (CC BY 4.0).`,
  '',
  `Districts: ${districts.length}`,
  '',
  '## Match method',
  '',
  ...Object.entries(report.byMethod).map(([m, n]) => `- ${m}: ${n}`),
  '',
  `## Unmatched (${report.unmatched.length}) - placed at the province centre`,
  '',
  ...(report.unmatched.length ? report.unmatched.map((u) => `- ${u}`) : ['- none']),
  '',
  `## Cache-key collisions (${collisions.length})`,
  '',
  ...(collisions.length ? collisions.map((c) => `- ${c}`) : ['- none']),
  '',
  '## Province centres corrected (provinces.json vs GeoNames capital, >5 km)',
  '',
  ...(report.provinceCheck.length ? report.provinceCheck.map((c) => `- ${c}`) : ['- all within 5 km']),
  '',
  '## Largest corrections (old random point -> real place)',
  '',
  '| District | Moved | Method |',
  '|---|---:|---|',
  ...moved.slice(0, 40).map((m) => `| ${m.name} | ${m.km.toFixed(1)} km | ${m.method} |`),
  '',
  `Median correction: ${moved[Math.floor(moved.length / 2)].km.toFixed(1)} km`,
  '',
];
const text = lines.join('\n');
console.log(text);
if (REPORT) writeFileSync(REPORT, text);
