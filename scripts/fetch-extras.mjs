import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Everything the pages show beside the forecast itself, fetched once per
 * build into src/data/extras-cache.json:
 *
 *   air       Open-Meteo Air Quality (CAMS): European AQI, PM2.5, PM10,
 *             hourly for today and tomorrow, at the 81 province centres.
 *   sea       Open-Meteo Marine: sea surface temperature (hourly) and the
 *             day's highest wave, at one offshore point per coastal province
 *             (src/data/coastalPoints.json).
 *   warnings  MeteoAlarm: the yellow / orange / red warnings the Turkish
 *             State Meteorological Service publishes for Turkey.
 *
 * None of this may break the forecast build. Each section is fetched on its
 * own; a section that fails keeps the previous build's data when that is
 * still about today (warnings: still unexpired), and is otherwise left empty,
 * which hides the related boxes and pages. The script always exits 0.
 *
 * Cost: about 110 Open-Meteo calls per build (81 AQ + 28 marine locations,
 * 2 days, 3 or fewer variables), twice a day.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argValue = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? argv[i + 1] : undefined;
};
const OUT = argValue('out') ?? join(__dirname, '..', 'src', 'data', 'extras-cache.json');
const VERBOSE = argv.includes('--verbose');
const TIMEZONE = 'Europe/Istanbul';
const TIMEOUT_MS = 25000;

const AQ_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';
// MeteoAlarm has no Turkey feed today (both URLs answer 404). The site then
// shows its own forecast-based alerts (src/lib/alerts.ts) only; should the
// Turkish State Meteorological Service start publishing to MeteoAlarm, the
// official warnings appear on the pages without a code change.
const MA_SLUGS = ['turkiye', 'turkey'];
const MA_JSON_URL = (slug) => `https://feeds.meteoalarm.org/api/v1/warnings/feeds-${slug}`;
const MA_ATOM_URL = (slug) => `https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-${slug}`;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[EXTRAS]', ...a);

export function today(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

async function get(url, { json = true, tries = 2 } = {}) {
  let last;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'yarinhava.com build (https://yarinhava.com)' },
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      return json ? await res.json() : await res.text();
    } catch (err) {
      last = err;
      if (attempt < tries) await delay(3000 * attempt);
    }
  }
  throw last;
}

const round1 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

/** Slices a 48-hour series that must start at 00:00 on `day`; null otherwise. */
function hours48(h, day, fields) {
  if (!h?.time?.length || h.time[0] !== `${day}T00:00`) return null;
  const n = Math.min(48, h.time.length);
  const out = { time: h.time.slice(0, n) };
  for (const [to, from] of Object.entries(fields)) out[to] = (h[from] ?? []).slice(0, n).map(round1);
  return out;
}

// --- Air quality -----------------------------------------------------------

export async function fetchAir(provinces, day) {
  const out = {};
  // Several coordinates per request; the API answers with an array.
  for (let i = 0; i < provinces.length; i += 27) {
    const chunk = provinces.slice(i, i + 27);
    const params = new URLSearchParams({
      latitude: chunk.map((p) => p.lat.toFixed(3)).join(','),
      longitude: chunk.map((p) => p.lon.toFixed(3)).join(','),
      hourly: 'european_aqi,pm2_5,pm10',
      timezone: TIMEZONE,
      forecast_days: '2',
    });
    const res = await get(`${AQ_URL}?${params}`);
    const list = Array.isArray(res) ? res : [res];
    list.forEach((d, j) => {
      const s = hours48(d.hourly, day, { aqi: 'european_aqi', pm25: 'pm2_5', pm10: 'pm10' });
      if (s && s.aqi.some((v) => v !== null)) out[chunk[j].plate] = s;
    });
    if (i + 27 < provinces.length) await delay(1500);
  }
  return out;
}

// --- Sea surface temperature -------------------------------------------------

export async function fetchSea(points, day) {
  const out = {};
  const params = new URLSearchParams({
    latitude: points.map((p) => p.lat).join(','),
    longitude: points.map((p) => p.lon).join(','),
    hourly: 'sea_surface_temperature',
    daily: 'wave_height_max',
    timezone: TIMEZONE,
    forecast_days: '2',
  });
  const res = await get(`${MARINE_URL}?${params}`);
  const list = Array.isArray(res) ? res : [res];
  list.forEach((d, j) => {
    const p = points[j];
    const s = hours48(d.hourly, day, { sst: 'sea_surface_temperature' });
    if (!s || !s.sst.some((v) => v !== null)) {
      if (VERBOSE) log(`sea: no SST for plate ${p.plate} (${p.place}) at ${p.lat},${p.lon}`);
      return;
    }
    out[p.plate] = { ...s, waveMax: (d.daily?.wave_height_max ?? []).slice(0, 2).map(round1) };
  });
  return out;
}

// --- Warnings ----------------------------------------------------------------

/** "2; yellow; Moderate" -> 2. Falls back to the CAP severity. */
export function awarenessLevel(level, severity) {
  const n = parseInt(String(level ?? ''), 10);
  if (n >= 1 && n <= 4) return n;
  const s = String(level ?? '').toLowerCase();
  if (s.includes('red')) return 4;
  if (s.includes('orange')) return 3;
  if (s.includes('yellow')) return 2;
  if (s.includes('green')) return 1;
  return { extreme: 4, severe: 3, moderate: 2, minor: 1 }[String(severity ?? '').toLowerCase()] ?? 0;
}

/** "1; Wind" -> "wind". */
export function awarenessType(type, event) {
  const t = String(type ?? '').split(';').pop().trim().toLowerCase();
  if (t) return t.replace(/[^a-z-]+/g, '-').replace(/^-|-$/g, '');
  const e = String(event ?? '').toLowerCase();
  if (/snow|ice|kar|buz/.test(e)) return 'snow-ice';
  if (/thunder|storm|fırtına|gök/.test(e)) return 'thunderstorm';
  if (/wind|rüzgar/.test(e)) return 'wind';
  if (/rain|yağış|yağmur|sağanak/.test(e)) return 'rain';
  if (/fog|sis/.test(e)) return 'fog';
  if (/high.?temp|heat|sıcak/.test(e)) return 'high-temperature';
  if (/low.?temp|cold|soğuk|don/.test(e)) return 'low-temperature';
  return 'other';
}

const param = (info, name) => (info.parameter ?? []).find((p) => p.valueName === name)?.value;

/** One CAP info block (JSON API shape) -> our warning record. */
function fromCapInfo(info, id) {
  return {
    id,
    lang: String(info.language ?? '').toLowerCase(),
    level: awarenessLevel(param(info, 'awareness_level'), info.severity),
    type: awarenessType(param(info, 'awareness_type'), info.event),
    event: info.event ?? '',
    headline: info.headline ?? '',
    description: info.description ?? '',
    instruction: info.instruction ?? '',
    onset: info.onset ?? info.effective ?? null,
    expires: info.expires ?? null,
    areas: (info.area ?? []).map((a) => a.areaDesc).filter(Boolean),
  };
}

/** MeteoAlarm JSON API: { warnings: [ { uuid, alert: { identifier, info: [...] } } ] }. */
export function parseMeteoalarmJson(doc) {
  const out = [];
  for (const w of doc?.warnings ?? []) {
    const alert = w.alert ?? w;
    const infos = alert.info ?? [];
    // One record per alert, in Turkish when the alert carries Turkish.
    const info =
      infos.find((i) => /^tr/i.test(i.language ?? '')) ?? infos.find((i) => /^en/i.test(i.language ?? '')) ?? infos[0];
    if (!info) continue;
    out.push(fromCapInfo(info, alert.identifier ?? w.uuid ?? String(out.length)));
  }
  return out;
}

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<(?:cap:)?${name}[^>]*>([\\s\\S]*?)</(?:cap:)?${name}>`, 'i'));
  return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
};

/** Legacy Atom feed: one <entry> per alert with cap:* children. */
export function parseMeteoalarmAtom(xml) {
  const out = [];
  for (const [, entry] of String(xml).matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const level = (entry.match(/awareness_level<\/valueName>\s*<value>([^<]*)/) ?? [])[1];
    const type = (entry.match(/awareness_type<\/valueName>\s*<value>([^<]*)/) ?? [])[1];
    out.push({
      id: tag(entry, 'identifier') || tag(entry, 'id') || String(out.length),
      lang: '',
      level: awarenessLevel(level, tag(entry, 'severity')),
      type: awarenessType(type, tag(entry, 'event')),
      event: tag(entry, 'event'),
      headline: tag(entry, 'title'),
      description: '',
      instruction: '',
      onset: tag(entry, 'onset') || tag(entry, 'effective') || null,
      expires: tag(entry, 'expires') || null,
      areas: [tag(entry, 'areaDesc')].filter(Boolean),
    });
  }
  return out;
}

/** "Kahramanmaraş" / "KAHRAMANMARAS" / "Kahramanmaras Province" -> "kahramanmaras". */
export function norm(s) {
  return String(s ?? '')
    .toLocaleLowerCase('tr')
    .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/i̇/g, 'i')
    .replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u').replace(/â/g, 'a').replace(/î/g, 'i').replace(/û/g, 'u')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const ALIASES = { afyon: 3, 'k maras': 46, maras: 46, antep: 27, urfa: 63, icel: 33, izmit: 41, adapazari: 54 };

/** Plates of the provinces an area description names. */
export function matchPlates(areaDesc, provinces) {
  const a = ` ${norm(areaDesc)} `;
  const plates = new Set();
  for (const p of provinces) {
    if (a.includes(` ${norm(p.name)} `)) plates.add(p.plate);
  }
  for (const [alias, plate] of Object.entries(ALIASES)) {
    if (a.includes(` ${alias} `)) plates.add(plate);
  }
  return [...plates];
}

export function finaliseWarnings(list, provinces, now = Date.now()) {
  const seen = new Set();
  return list
    .filter((w) => w.level >= 2)
    .filter((w) => !w.expires || new Date(w.expires).getTime() > now)
    .map((w) => ({ ...w, plates: [...new Set(w.areas.flatMap((a) => matchPlates(a, provinces)))].sort((x, y) => x - y) }))
    .filter((w) => {
      const key = `${w.level}|${w.type}|${w.onset}|${w.expires}|${w.areas.join(',')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.level - a.level || String(a.onset).localeCompare(String(b.onset)));
}

export async function fetchWarnings(provinces) {
  let list = null;
  let source = '';
  for (const slug of MA_SLUGS) {
    try {
      const doc = await get(MA_JSON_URL(slug), { tries: 1 });
      list = parseMeteoalarmJson(doc);
      source = `meteoalarm-json:${slug}`;
      if (VERBOSE) log(`warnings json: top-level keys ${Object.keys(doc ?? {}).join(',')}; ${doc?.warnings?.length ?? 0} entries`);
      if (VERBOSE && doc?.warnings?.[0]) log('warnings json sample:', JSON.stringify(doc.warnings[0]).slice(0, 1500));
      break;
    } catch (err) {
      try {
        const xml = await get(MA_ATOM_URL(slug), { json: false, tries: 1 });
        list = parseMeteoalarmAtom(xml);
        source = `meteoalarm-atom:${slug}`;
        if (VERBOSE) log('warnings atom sample:', String(xml).slice(0, 1500));
        break;
      } catch (err2) {
        log(`no MeteoAlarm feed for "${slug}" (${err.message.slice(0, 40)} / ${err2.message.slice(0, 40)})`);
      }
    }
  }
  if (!list) throw new Error('no MeteoAlarm feed for Turkey');
  const items = finaliseWarnings(list, provinces);
  if (VERBOSE) {
    const areas = [...new Set(list.flatMap((w) => w.areas))];
    log(`warnings: ${list.length} parsed, ${items.length} active yellow+; areas seen (${areas.length}): ${areas.slice(0, 40).join(' | ')}`);
    const unmatched = [...new Set(items.filter((w) => !w.plates.length).flatMap((w) => w.areas))];
    if (unmatched.length) log(`warnings: areas without a province match: ${unmatched.join(' | ')}`);
  }
  return { source, items };
}

// --- Main ----------------------------------------------------------------------

function readPrev() {
  if (!existsSync(OUT)) return null;
  try {
    return JSON.parse(readFileSync(OUT, 'utf-8'));
  } catch {
    return null;
  }
}

async function main() {
  const day = today();
  const provinces = JSON.parse(readFileSync(join(__dirname, '..', 'src', 'data', 'provinces.json'), 'utf-8'));
  const { points } = JSON.parse(readFileSync(join(__dirname, '..', 'src', 'data', 'coastalPoints.json'), 'utf-8'));
  const prev = readPrev();
  const prevToday = prev && !prev.synthetic && prev.day === day ? prev : null;

  const result = { fetchedAt: new Date().toISOString(), day, air: {}, sea: {}, warnings: { source: '', ok: false, items: [] } };

  try {
    result.air = await fetchAir(provinces, day);
    log(`air quality: ${Object.keys(result.air).length}/${provinces.length} provinces`);
    if (VERBOSE) {
      const p = result.air[34];
      if (p) log(`air sample (İstanbul): aqi[0..12]=${p.aqi.slice(0, 13).join(',')} pm25[12]=${p.pm25[12]} pm10[12]=${p.pm10[12]}`);
    }
  } catch (err) {
    log(`::warning::air quality fetch failed: ${err.message}`);
  }
  if (Object.keys(result.air).length < 40 && prevToday) {
    result.air = prevToday.air ?? {};
    log(`air quality: kept ${Object.keys(result.air).length} provinces from the previous fetch today`);
  }

  try {
    result.sea = await fetchSea(points, day);
    log(`sea temperature: ${Object.keys(result.sea).length}/${points.length} points`);
    if (VERBOSE) {
      for (const pt of points) {
        const s = result.sea[pt.plate];
        log(`  sea ${pt.plate} ${pt.place}: sst[12]=${s?.sst?.[12] ?? '-'} wave=${s?.waveMax?.join('/') ?? '-'}`);
      }
    }
  } catch (err) {
    log(`::warning::sea temperature fetch failed: ${err.message}`);
  }
  if (Object.keys(result.sea).length < 10 && prevToday) {
    result.sea = prevToday.sea ?? {};
    log(`sea temperature: kept ${Object.keys(result.sea).length} points from the previous fetch today`);
  }

  try {
    const w = await fetchWarnings(provinces);
    result.warnings = { source: w.source, ok: true, items: w.items };
    log(`warnings: ${w.items.length} active (${w.source})`);
  } catch (err) {
    log(`::warning::warnings fetch failed: ${err.message}`);
    // Keep the previous list minus whatever has expired since; the pages
    // also hide expired warnings in the browser.
    const items = finaliseWarnings(prev?.warnings?.items ?? [], provinces);
    result.warnings = { source: prev?.warnings?.source ?? '', ok: false, items };
  }

  writeFileSync(OUT, JSON.stringify(result));
  log(`wrote ${OUT}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    // Never fail the build over extras.
    console.log(`::warning::[EXTRAS] ${err.stack ?? err}`);
  });
}
