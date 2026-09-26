import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getNearbyLocations, getNearbyProvinces, haversineKm } from '../src/lib/nearby.ts';

const districts = JSON.parse(readFileSync(new URL('../src/data/districts.json', import.meta.url)));
const provinces = JSON.parse(readFileSync(new URL('../src/data/provinces.json', import.meta.url)));

test('haversine matches a known distance', () => {
  // İstanbul (Fatih) to Ankara (Kızılay) is about 350 km as the crow flies.
  const km = haversineKm(41.0082, 28.9784, 39.9208, 32.8541);
  assert.ok(km > 340 && km < 360, `${km}`);
  assert.equal(haversineKm(40, 30, 40, 30), 0);
});

test('nearest districts to a district cross province borders and exclude self', () => {
  const near = getNearbyLocations('kocaeli', 'gebze');
  assert.equal(near.length, 12);
  assert.ok(!near.some((n) => n.provinceSlug === 'kocaeli' && n.slug === 'gebze'), 'must exclude self');
  const slugs = near.map((n) => `${n.provinceSlug}/${n.slug}`);
  assert.ok(slugs.includes('kocaeli/darica'), slugs.join());
  assert.ok(slugs.includes('istanbul/tuzla'), `Tuzla (İstanbul) should be near Gebze: ${slugs.join()}`);
  for (let i = 1; i < near.length; i++) assert.ok(near[i].km >= near[i - 1].km, 'sorted by distance');
  for (const n of near) {
    assert.equal(n.href, `/${n.provinceSlug}/${n.slug}-hava-durumu/`);
    assert.ok(n.name && n.provinceName && Number.isInteger(n.km));
  }
  assert.ok(near[0].km < 15, `nearest to Gebze is ${near[0].km} km away`);
});

test('province origin uses the province centre and respects limit', () => {
  const near = getNearbyLocations('istanbul', null, 5);
  assert.equal(near.length, 5);
  assert.ok(near.every((n) => n.km < 30), JSON.stringify(near));
  assert.deepEqual(getNearbyLocations('nope', null), []);
  assert.deepEqual(getNearbyLocations('kocaeli', 'nope'), []);
});

test('every district gets a full, self-free neighbour list', () => {
  for (const d of districts) {
    const near = getNearbyLocations(d.province, d.slug, 12);
    assert.equal(near.length, 12);
    assert.ok(!near.some((n) => n.provinceSlug === d.province && n.slug === d.slug));
    assert.equal(new Set(near.map((n) => n.href)).size, 12);
  }
});

test('display names disambiguate Merkez and shared names', () => {
  const near = getNearbyLocations('adiyaman', null, 30);
  const merkez = near.find((n) => n.slug === 'adiyaman-merkez');
  assert.ok(merkez, 'Adıyaman Merkez should be near the Adıyaman centre');
  assert.equal(merkez.name, 'Adıyaman Merkez');
  const golbasi = near.find((n) => n.slug === 'golbasi' && n.provinceSlug === 'adiyaman');
  if (golbasi) assert.equal(golbasi.name, 'Gölbaşı (Adıyaman)');
});

test('nearest provinces', () => {
  const near = getNearbyProvinces('kocaeli');
  assert.equal(near.length, 6);
  const slugs = near.map((p) => p.slug);
  assert.ok(!slugs.includes('kocaeli'));
  for (const s of ['sakarya', 'yalova', 'istanbul']) assert.ok(slugs.includes(s), slugs.join());
  assert.equal(near[0].href, `/${near[0].slug}-hava-durumu/`);
  for (let i = 1; i < near.length; i++) assert.ok(near[i].km >= near[i - 1].km);
  assert.equal(getNearbyProvinces('kocaeli', 3).length, 3);
  assert.deepEqual(getNearbyProvinces('nope'), []);
  for (const p of provinces) assert.equal(getNearbyProvinces(p.slug).length, 6);
});
