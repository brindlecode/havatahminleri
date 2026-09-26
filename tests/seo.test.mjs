import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  getPeriodSEO,
  getLocationNames,
  getHomeSEO,
  isAmbiguousDistrictName,
  generateStructuredData,
  buildBreadcrumbs,
} from '../src/lib/seo.ts';
import { getCityLocative } from '../src/lib/utils.ts';

const provinces = JSON.parse(readFileSync(new URL('../src/data/provinces.json', import.meta.url)));
const districts = JSON.parse(readFileSync(new URL('../src/data/districts.json', import.meta.url)));
const provBySlug = new Map(provinces.map((p) => [p.slug, p]));

const LOCATIONS = [
  ...provinces.map((p) => ({ provinceName: p.name, provinceSlug: p.slug, lat: p.lat, lon: p.lon })),
  ...districts.map((d) => ({
    provinceName: provBySlug.get(d.province).name,
    provinceSlug: d.province,
    districtName: d.name,
    districtSlug: d.slug,
    lat: d.lat,
    lon: d.lon,
  })),
];
const IDS = ['base', 'bugun', 'yarin', '7gun', '10gun', '15gun', 'saatlik'];
// Longest condition text ("dondurucu şiddetli yağmur") and a negative low.
const WEATHER = { temperature: -12.4, weatherCode: 67, maxTemp: -2.2, minTemp: -15.6 };

test('every location title fits in 60 characters and keeps the keyword first', () => {
  for (const weather of [undefined, WEATHER]) {
    for (const loc of LOCATIONS) {
      const names = getLocationNames(loc);
      for (const id of IDS) {
        const { title } = getPeriodSEO(loc, id, weather);
        assert.ok(title.length <= 60, `${title.length}: ${title}`);
        assert.ok(title.startsWith(names.qualified), title);
        assert.match(title, /Hava Durumu/);
      }
    }
  }
});

test('descriptions are 120-155 chars and unique across the whole site', () => {
  for (const weather of [undefined, WEATHER]) {
    const seen = new Map();
    for (const loc of LOCATIONS) {
      for (const id of IDS) {
        const { description, canonical } = getPeriodSEO(loc, id, weather);
        assert.ok(
          description.length >= 120 && description.length <= 155,
          `${description.length}: ${description}`,
        );
        assert.ok(!seen.has(description), `duplicate description on ${canonical} and ${seen.get(description)}`);
        seen.set(description, canonical);
      }
    }
  }
  const home = getHomeSEO();
  assert.ok(home.title.length <= 60);
  assert.ok(home.description.length >= 120 && home.description.length <= 160, home.description);
});

test('titles and H1s are unique across the whole site', () => {
  const titles = new Set();
  const headings = new Set();
  for (const loc of LOCATIONS) {
    for (const id of IDS) {
      const { title, heading } = getPeriodSEO(loc, id);
      assert.ok(!titles.has(title), `duplicate title ${title}`);
      assert.ok(!headings.has(heading), `duplicate H1 ${heading}`);
      titles.add(title);
      headings.add(heading);
    }
  }
});

test('shared district names carry the province in the H1 and description', () => {
  assert.ok(isAmbiguousDistrictName('Ortaköy'));
  assert.ok(isAmbiguousDistrictName('Yenişehir'));
  assert.ok(!isAmbiguousDistrictName('Merkez'));
  assert.ok(!isAmbiguousDistrictName('Gebze'));

  const ortakoy = { provinceName: 'Çorum', provinceSlug: 'corum', districtName: 'Ortaköy', districtSlug: 'ortakoy', lat: 40.27, lon: 35.25 };
  const names = getLocationNames(ortakoy);
  assert.equal(names.display, 'Ortaköy (Çorum)');
  assert.equal(names.short, 'Ortaköy');
  for (const id of IDS) {
    const seo = getPeriodSEO(ortakoy, id);
    assert.ok(seo.heading.startsWith('Ortaköy (Çorum) '), seo.heading);
    assert.match(seo.description, /Çorum/);
    assert.ok(seo.schemaName.startsWith('Ortaköy, Çorum '), seo.schemaName);
    assert.ok(!/\(Çorum\)/.test(seo.schemaName), seo.schemaName);
  }
  assert.equal(getPeriodSEO(ortakoy, 'base').heading, 'Ortaköy (Çorum) Hava Durumu');

  const gebze = { provinceName: 'Kocaeli', provinceSlug: 'kocaeli', districtName: 'Gebze', districtSlug: 'gebze', lat: 40.8, lon: 29.43 };
  assert.equal(getPeriodSEO(gebze, '15gun').heading, 'Gebze 15 Günlük Hava Durumu');
  assert.equal(getPeriodSEO(gebze, '15gun').schemaName, 'Gebze, Kocaeli 15 Günlük Hava Durumu');
});

test('locative attaches to the place, not to the province qualifier', () => {
  assert.equal(getCityLocative('Ortaköy (Çorum)'), "Ortaköy'de (Çorum)");
  assert.equal(getCityLocative('Kemer (Antalya)'), "Kemer'de (Antalya)");
  assert.equal(getCityLocative('Aksu (Isparta)'), "Aksu'da (Isparta)");
  assert.equal(getCityLocative('Kars'), "Kars'ta");
});

test('structured data: Organization logo, no SearchAction, valid BreadcrumbList', () => {
  const kocaeli = { provinceName: 'Kocaeli', provinceSlug: 'kocaeli', districtName: 'Gebze', districtSlug: 'gebze', lat: 40.8, lon: 29.43 };
  const crumbs = buildBreadcrumbs(kocaeli, '15gun');
  const out = generateStructuredData('location', {
    name: 'x', description: 'y', url: 'https://yarinhava.com/kocaeli/gebze-hava-durumu/15-gunluk/', breadcrumbs: crumbs,
  });
  const items = out.split('\n').map((l) => JSON.parse(l));
  const page = items.find((i) => i['@type'] === 'WebPage');
  assert.equal(page.publisher.logo.url, 'https://yarinhava.com/icon-512.png');
  const bc = items.find((i) => i['@type'] === 'BreadcrumbList');
  bc.itemListElement.forEach((el, i) => {
    assert.equal(el.position, i + 1);
    assert.ok(el.item.startsWith('https://yarinhava.com/') && el.item.endsWith('/'), el.item);
    assert.ok(el.name);
  });

  const home = generateStructuredData('home', { name: 'Yarın Hava', description: 'd', url: 'https://yarinhava.com/' })
    .split('\n').map((l) => JSON.parse(l));
  const org = home.find((i) => i['@type'] === 'Organization');
  assert.equal(org.logo.url, 'https://yarinhava.com/icon-512.png');
  const site = home.find((i) => i['@type'] === 'WebSite');
  assert.equal(site.potentialAction, undefined, 'no SearchAction without a search results URL');
});
