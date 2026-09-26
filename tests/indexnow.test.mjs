import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { extractLocs } from '../scripts/indexnow.mjs';

test('extractLocs reads sitemap <loc> entries', () => {
  const xml = `<?xml version="1.0"?><urlset><url><loc>https://yarinhava.com/</loc></url>
    <url><loc> https://yarinhava.com/a-hava-durumu/?x=1&amp;y=2 </loc></url></urlset>`;
  assert.deepEqual(extractLocs(xml), ['https://yarinhava.com/', 'https://yarinhava.com/a-hava-durumu/?x=1&y=2']);
});

test('exactly one IndexNow key file, containing its own key, matches the script', () => {
  const keys = readdirSync(new URL('../public/', import.meta.url)).filter((f) => /^[0-9a-f]{32}\.txt$/.test(f));
  assert.equal(keys.length, 1, keys.join());
  const key = keys[0].slice(0, 32);
  assert.equal(readFileSync(new URL(`../public/${keys[0]}`, import.meta.url), 'utf-8').trim(), key);
  assert.match(readFileSync(new URL('../scripts/indexnow.mjs', import.meta.url), 'utf-8'), new RegExp(`'${key}'`));
});
