import test from 'node:test';
import assert from 'node:assert/strict';
import { ICON_GROUPS, iconGroupFor, groupsForIcons, buildIconSprite, groupDescriptions } from '../src/lib/iconLegend.ts';
import { weatherCodes } from '../src/lib/weatherCodes.ts';
import { getIconSVG } from '../src/lib/weatherIconSvg.ts';

const CODES = Object.keys(weatherCodes).map(Number);

test('every weather code, day and night, has a legend entry with the same drawing', () => {
  for (const code of CODES) {
    for (const isDay of [true, false]) {
      const g = iconGroupFor(code, isDay);
      assert.ok(g, `no legend entry for code ${code} isDay=${isDay}`);
      assert.equal(getIconSVG(g.code, g.isDay), getIconSVG(code, isDay), `code ${code} isDay=${isDay} -> ${g.id}`);
    }
  }
});

test('each legend entry is a distinct drawing', () => {
  const drawings = ICON_GROUPS.map((g) => getIconSVG(g.code, g.isDay));
  assert.equal(new Set(drawings).size, drawings.length);
  assert.equal(new Set(ICON_GROUPS.map((g) => g.id)).size, ICON_GROUPS.length);
});

test('the page legend lists only the icons used, once each, in catalogue order', () => {
  const groups = groupsForIcons([
    { code: 63, isDay: true }, { code: 0, isDay: false }, { code: 61, isDay: false },
    { code: 0, isDay: true }, { code: 999, isDay: true },
  ]);
  assert.deepEqual(groups.map((g) => g.id), ['ic-clear-day', 'ic-clear-night', 'ic-rain']);
});

test('sprite has a symbol for every entry', () => {
  const sprite = buildIconSprite();
  for (const g of ICON_GROUPS) assert.match(sprite, new RegExp(`<symbol id="${g.id}" viewBox="0 0 48 48"`));
});

test('descriptions list the forecast wordings behind an icon', () => {
  const rain = ICON_GROUPS.find((g) => g.id === 'ic-rain');
  assert.deepEqual(groupDescriptions(rain), ['Hafif Yağmur', 'Orta Yağmur', 'Dondurucu Hafif Yağmur', 'Hafif Sağanak', 'Orta Sağanak']);
});
