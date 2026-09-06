import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { slugify, foldTurkish, isLegacyDottedISlug } from '../src/lib/slug.ts';

test('slugify handles every Turkish-specific letter', () => {
  const cases = {
    // The regression that produced i-zmit / i-negol / i-skenderun in production:
    // "İ".toLowerCase() is "i" + U+0307, and the combining dot became a "-".
    'İzmit': 'izmit',
    'İnegöl': 'inegol',
    'İskenderun': 'iskenderun',
    'İstanbul': 'istanbul',
    'İzmir': 'izmir',
    'İpsala': 'ipsala',
    'İznik': 'iznik',
    'İspir': 'ispir',
    'İliç': 'ilic',
    'İscehisar': 'iscehisar',
    'İnönü': 'inonu',
    'İmamoğlu': 'imamoglu',
    // Dotless I / ı
    'Iğdır': 'igdir',
    'Isparta': 'isparta',
    'Bartın': 'bartin',
    // The rest of the Turkish alphabet
    'Şişli': 'sisli',
    'Çeşme': 'cesme',
    'Gölcük': 'golcuk',
    'Ödemiş': 'odemis',
    'Üsküdar': 'uskudar',
    'Ağrı': 'agri',
    'Kahramanmaraş': 'kahramanmaras',
    'Şırnak': 'sirnak',
    'Beyoğlu': 'beyoglu',
    // Circumflex vowels
    'Hakkâri': 'hakkari',
    'Şehitkâmil': 'sehitkamil',
    // Multi-word and numeric names
    'Ondokuzmayıs': 'ondokuzmayis',
    '19 Mayıs': '19-mayis',
    'Şarkışla': 'sarkisla',
  };

  for (const [input, expected] of Object.entries(cases)) {
    assert.equal(slugify(input), expected, `slugify(${input})`);
  }
});

test('slugify output is always URL-safe and normalised', () => {
  for (const input of ['  İzmit  ', '--İzmit--', 'İz/mit', 'İz—mit', 'A  B']) {
    const slug = slugify(input);
    assert.match(slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${input} -> ${slug}`);
  }
});

test('slugify never emits a combining mark', () => {
  for (const ch of ['İ', 'Ğ', 'Ş', 'Ç', 'Ö', 'Ü', 'Â', 'Î', 'Û']) {
    const slug = slugify(`${ch}test`);
    assert.equal(slug.normalize('NFD'), slug, `${ch} left a combining mark`);
    assert.match(slug, /^[a-z]+$/);
  }
});

test('foldTurkish is case-insensitive over the Turkish alphabet', () => {
  assert.equal(foldTurkish('İIıi'), 'iiii');
  assert.equal(foldTurkish('ÇçĞğÖöŞşÜü'), 'ccggoossuu');
});

test('isLegacyDottedISlug identifies the corrupted production slugs', () => {
  assert.ok(isLegacyDottedISlug('i-zmit'));
  assert.ok(isLegacyDottedISlug('i-negol'));
  assert.ok(!isLegacyDottedISlug('izmit'));
  assert.ok(!isLegacyDottedISlug('i-'));
  // A legitimate slug that merely starts with "i" must not be flagged.
  assert.ok(!isLegacyDottedISlug('isparta'));
});

/**
 * 27 districts shipped with the corrupted "i-" slug before the slugifier was
 * fixed. Their URLs are indexed and ranking, so correcting them is a URL
 * migration that needs redirects and sign-off, not a data edit - see
 * docs/seo-recovery-plan.md.
 *
 * This list is frozen. The test below allows exactly these and fails on any
 * new mismatch, so no further malformed slug can reach production while the
 * migration is pending.
 */
const KNOWN_LEGACY_SLUGS = new Set([
  'i-mamoglu', 'i-hsaniye', 'i-scehisar', 'i-bradi', 'i-ncirliova', 'i-vrindi',
  'i-nhisar', 'i-negol', 'i-znik', 'i-skilip', 'i-psala', 'i-lic', 'i-spir',
  'i-nonu', 'i-slahiye', 'i-skenderun', 'i-hsangazi', 'i-nebolu', 'i-ncesu',
  'i-zmit', 'i-kizce', 'i-kizdere', 'i-yidere', 'i-lkadim', 'i-dil',
  'i-mranli', 'i-pekyolu',
]);

test('no new malformed slug can enter the data files', () => {
  const provinces = JSON.parse(readFileSync(new URL('../src/data/provinces.json', import.meta.url)));
  const districts = JSON.parse(readFileSync(new URL('../src/data/districts.json', import.meta.url)));

  const mismatches = [];
  for (const p of provinces) {
    if (p.slug !== slugify(p.name)) mismatches.push(`province ${p.name} -> ${p.slug}`);
  }
  for (const d of districts) {
    // "Merkez" districts and cross-province duplicates are intentionally
    // suffixed with the province slug; only check the rest.
    if (d.name === 'Merkez') continue;
    if (KNOWN_LEGACY_SLUGS.has(d.slug)) continue;
    const expected = slugify(d.name);
    if (d.slug !== expected && d.slug !== `${expected}-${d.province}`) {
      mismatches.push(`district ${d.name} (${d.province}) -> ${d.slug}, expected ${expected}`);
    }
  }

  assert.deepEqual(mismatches, [], `${mismatches.length} slug(s) do not match the canonical slugifier`);
});

test('the frozen legacy-slug list still matches the data exactly', () => {
  const districts = JSON.parse(readFileSync(new URL('../src/data/districts.json', import.meta.url)));
  const inData = new Set(districts.filter((d) => isLegacyDottedISlug(d.slug)).map((d) => d.slug));

  assert.deepEqual(
    [...inData].sort(),
    [...KNOWN_LEGACY_SLUGS].sort(),
    'The set of corrupted slugs in the data changed. If the migration was applied, ' +
      'empty KNOWN_LEGACY_SLUGS and confirm the redirect map covers every old path.',
  );
});
