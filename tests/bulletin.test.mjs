import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildBulletin, bulletinSlug, bulletinPath, bulletinText, joinNames, joinLocative,
} from '../src/lib/bulletin.ts';
import { buildFacts, istanbulToday } from '../scripts/make-bulletin.mjs';

const data = (f) => JSON.parse(readFileSync(new URL(`../src/data/${f}`, import.meta.url), 'utf-8'));
const provinces = data('provinces.json');
const ctx = { provinces, regions: data('regions.json'), climate: data('climate.json').provinces };

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Deterministic pseudo-random weather for 81 provinces, varying with `seed`. */
function facts(date, seed, tweak = () => {}) {
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const days = Array.from({ length: 7 }, (_, i) => addDays(date, i));
  return {
    version: 1,
    date,
    fetchedAt: `${date}T21:05:00.000Z`,
    generatedAt: `${date}T21:10:00.000Z`,
    days,
    provinces: provinces.map((p) => ({
      plate: p.plate,
      d: days.map((_, i) => {
        const hi = Math.round((8 + rnd() * 18) * 10) / 10;
        const wet = rnd() < 0.3;
        const t = [hi, Math.round((hi - 6 - rnd() * 6) * 10) / 10, wet ? 61 : 1, wet ? Math.round(rnd() * 120) / 10 : 0, wet ? 80 : 10, Math.round(10 + rnd() * 25)];
        tweak(p, i, t);
        return t;
      }),
    })),
  };
}

test('slugs and paths', () => {
  assert.equal(bulletinSlug('2026-10-25'), '25-ekim-2026-hava-durumu');
  assert.equal(bulletinSlug('2026-02-03'), '3-subat-2026-hava-durumu');
  assert.equal(bulletinPath('2026-08-01'), '/bulten/1-agustos-2026-hava-durumu/');
});

test('name lists take the suffix on the last name only', () => {
  assert.equal(joinNames(['Rize']), 'Rize');
  assert.equal(joinNames(['Rize', 'Artvin', 'Trabzon']), 'Rize, Artvin ve Trabzon');
  assert.equal(joinLocative(['Erzurum', 'Kars']), "Erzurum ve Kars'ta");
  assert.equal(joinLocative(['Van']), "Van'da");
});

test('a full bulletin: title, headline, description and sections', () => {
  const b = buildBulletin(facts('2026-10-25', 1), ctx);
  assert.ok(b.title.length <= 60, b.title);
  assert.match(b.headline, /^25 Ekim 2026 hava durumu/);
  assert.ok(b.description.length <= 155, `${b.description.length}: ${b.description}`);
  assert.equal(b.url, 'https://yarinhava.com/bulten/25-ekim-2026-hava-durumu/');
  assert.equal(b.imageUrl, 'https://yarinhava.com/og/bulten/2026-10-25.png');
  const ids = b.sections.map((s) => s.id);
  for (const id of ['sicakliklar', 'yagis', 'mevsim-normalleri', 'bolgeler', 'buyuk-sehirler', 'yarin', 'tum-iller']) {
    assert.ok(ids.includes(id), `missing section ${id}`);
  }
  assert.equal(ids.at(-1), 'tum-iller');
  assert.equal(b.sections.find((s) => s.id === 'tum-iller').table.rows.length, 81);
  assert.equal(b.mapPoints.length, 81);
  // Sunday: no weekend section.
  assert.ok(!ids.includes('hafta-sonu'));
});

test('the numbers in the prose come from the data', () => {
  const f = facts('2026-10-25', 2);
  const b = buildBulletin(f, ctx);
  const hottest = f.provinces.reduce((a, x) => (x.d[0][0] > a.d[0][0] ? x : a));
  const name = provinces.find((p) => p.plate === hottest.plate).name;
  const temp = `${Math.round(hottest.d[0][0])}°`;
  const sicak = b.sections.find((s) => s.id === 'sicakliklar').paragraphs[0];
  assert.ok(sicak.includes(name) && sicak.includes(temp), `${sicak} / ${name} ${temp}`);
  assert.ok(b.lead.includes(temp));
});

test('snow leads the headline and the precipitation section', () => {
  const f = facts('2026-12-03', 3, (p, i, t) => {
    if (i === 0 && (p.slug === 'erzurum' || p.slug === 'kars')) { t[2] = 73; t[3] = 8; t[0] = -2; t[1] = -9; }
  });
  const b = buildBulletin(f, ctx);
  assert.match(b.headline, /Erzurum ve Kars'ta kar yağışı|Kars ve Erzurum'da kar yağışı/);
  const yagis = b.sections.find((s) => s.id === 'yagis').paragraphs.join(' ');
  assert.match(yagis, /Kar yağışı beklenen iller: .*(Erzurum|Kars)/);
});

test('a dry day says so and has no rain table', () => {
  const f = facts('2026-07-15', 4, (p, i, t) => { t[2] = 0; t[3] = 0; t[4] = 0; });
  const b = buildBulletin(f, ctx);
  const yagis = b.sections.find((s) => s.id === 'yagis');
  assert.equal(yagis.table, undefined);
  assert.match(yagis.paragraphs[0], /yağış beklenmiyor|kuru bir gün|hiçbirinde/);
  assert.match(b.lead, /kayda değer yağış beklenmiyor/);
});

test('alerts get their own section with the official-source note', () => {
  const f = facts('2026-10-25', 5, (p, i, t) => {
    if (i === 0 && p.slug === 'rize') { t[2] = 65; t[3] = 60; t[4] = 95; }
  });
  const b = buildBulletin(f, ctx);
  const s = b.sections.find((x) => x.id === 'uyarilar');
  assert.ok(s);
  assert.match(s.paragraphs[0], /Kuvvetli yağış \(Tehlike\): Rize/);
  assert.match(s.paragraphs.at(-1), /Meteoroloji Genel Müdürlüğü/);
  assert.match(b.headline, /Rize'de kuvvetli yağış/);
});

test('storms with and without hail are listed separately', () => {
  const f = facts('2026-10-25', 8, (p, i, t) => {
    if (i !== 0) return;
    if (p.slug === 'adana') { t[2] = 96; t[3] = 10; }
    if (p.slug === 'adiyaman') { t[2] = 95; t[3] = 10; }
  });
  const paras = buildBulletin(f, ctx).sections.find((x) => x.id === 'uyarilar').paragraphs;
  const hail = paras.find((x) => x.startsWith('Gök gürültülü sağanak ve dolu'));
  const plain = paras.find((x) => x.startsWith('Gök gürültülü sağanak (') );
  assert.ok(hail && hail.includes('Adana') && !hail.includes('Adıyaman'), hail);
  assert.ok(plain && plain.includes('Adıyaman') && !plain.includes('Adana'), plain);
});

test('Thursday and Friday bulletins carry the weekend', () => {
  assert.ok(buildBulletin(facts('2026-10-22', 6), ctx).sections.some((s) => s.id === 'hafta-sonu'));
  assert.ok(buildBulletin(facts('2026-10-23', 6), ctx).sections.some((s) => s.id === 'hafta-sonu'));
  assert.ok(!buildBulletin(facts('2026-10-24', 6), ctx).sections.some((s) => s.id === 'hafta-sonu'));
});

test('consecutive days never share the same wording', () => {
  // Same weather every day, so any repeat would come from the templates.
  const WORDS = /(?<!\p{L})(Pazartesi|Salı|Çarşamba|Perşembe|Cumartesi|Cuma|Pazar|Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık)(?!\p{L})/gu;
  const strip = (t) => t.replace(/-?\d+([.,]\d+)?/g, '#').replace(WORDS, 'W');
  let prev = null;
  for (let i = 0; i < 30; i++) {
    const date = addDays('2026-11-01', i);
    const f = facts(date, 7);
    const text = strip(bulletinText(buildBulletin(f, ctx)));
    if (prev) assert.notEqual(text, prev, `${date} repeats the previous day's wording`);
    prev = text;
  }
});

test('buildFacts freezes 81 provinces x 7 days and refuses stale or synthetic caches', () => {
  const now = new Date('2026-10-25T21:30:00Z'); // 00:30 on 26 October in Istanbul
  const today = istanbulToday(now);
  assert.equal(today, '2026-10-26');
  const daily = (start) => {
    const time = Array.from({ length: 16 }, (_, i) => addDays(start, i));
    const v = (x) => time.map(() => x);
    return { time, temperatureMax: v(20.04), temperatureMin: v(10), weatherCode: v(3), precipitationSum: v(0), precipitationProbabilityMax: v(5), windSpeedMax: v(12) };
  };
  const cache = (start) => ({
    fetchedAt: now.toISOString(),
    data: Object.fromEntries(provinces.map((p) => [`${p.lat.toFixed(2)}_${p.lon.toFixed(2)}`, { daily: daily(start) }])),
  });

  const ok = buildFacts(cache(today), provinces, { now });
  assert.equal(ok.facts.provinces.length, 81);
  assert.equal(ok.facts.days.length, 7);
  assert.equal(ok.facts.date, today);
  assert.deepEqual(ok.facts.provinces[0].d[0], [20, 10, 3, 0, 5, 12]);

  assert.match(buildFacts(cache('2026-10-25'), provinces, { now }).skip, /only 0\/81/);
  assert.match(buildFacts({ ...cache(today), synthetic: true }, provinces, { now }).skip, /synthetic/);
  assert.ok(buildFacts({ ...cache(today), synthetic: true }, provinces, { now, allowSynthetic: true }).facts);
});
