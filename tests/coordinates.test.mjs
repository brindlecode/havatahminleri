import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The original district data placed every district at a random point near its
// province centre. These checks catch that class of data bug: randomly
// scattered points collide on forecast cache keys and have no relation to the
// real town.
const provinces = JSON.parse(readFileSync(new URL('../src/data/provinces.json', import.meta.url)));
const districts = JSON.parse(readFileSync(new URL('../src/data/districts.json', import.meta.url)));
const provBySlug = new Map(provinces.map((p) => [p.slug, p]));

function km(aLat, aLon, bLat, bLon) {
  const r = Math.PI / 180;
  const h = Math.sin(((bLat - aLat) * r) / 2) ** 2
    + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLon - aLon) * r) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

test('every district lies inside Turkey and near its province', () => {
  for (const d of districts) {
    const p = provBySlug.get(d.province);
    assert.ok(p, `${d.name}: unknown province ${d.province}`);
    assert.ok(d.lat > 35.8 && d.lat < 42.2 && d.lon > 25.6 && d.lon < 44.9, `${d.name}: ${d.lat},${d.lon} is outside Turkey`);
    assert.ok(km(p.lat, p.lon, d.lat, d.lon) < 200, `${d.name} (${p.name}) is over 200 km from its province centre`);
  }
});

test('no two non-central districts share a forecast cache key', () => {
  const seen = new Map();
  for (const d of districts) {
    if (d.name === 'Merkez') continue;
    const key = `${d.lat.toFixed(2)}_${d.lon.toFixed(2)}`;
    assert.ok(!seen.has(key), `${d.name} (${d.province}) and ${seen.get(key)} share ${key}`);
    seen.set(key, `${d.name} (${d.province})`);
  }
});

test('known district towns are where they really are', () => {
  // Reference points (town centres), tolerance 15 km.
  const known = [
    ['antalya', 'Alanya', 36.54, 32.0],
    ['adana', 'Kozan', 37.45, 35.81],
    ['kocaeli', 'İzmit', 40.77, 29.94],
    ['istanbul', 'Kadıköy', 40.99, 29.03],
    ['mugla', 'Bodrum', 37.04, 27.43],
  ];
  for (const [prov, name, lat, lon] of known) {
    const d = districts.find((x) => x.province === prov && x.name === name);
    assert.ok(d, `${name} missing`);
    assert.ok(km(lat, lon, d.lat, d.lon) < 15, `${name} is ${km(lat, lon, d.lat, d.lon).toFixed(1)} km from the real town`);
  }
});
