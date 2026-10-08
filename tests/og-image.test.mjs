import test from 'node:test';
import assert from 'node:assert/strict';
import { Resvg } from '@resvg/resvg-js';
import { buildOgSvg, ogDayIndex, ogImageSlug, ogImageUrl } from '../src/lib/ogImage.ts';

function makeWeather({ code = 1, prob = 5, sum = 0 } = {}) {
  const daily = {
    time: [], weatherCode: [], temperatureMax: [], temperatureMin: [],
    precipitationSum: [], precipitationProbabilityMax: [], windSpeedMax: [],
    uvIndexMax: [], sunrise: [], sunset: [],
  };
  for (let i = 0; i < 16; i++) {
    const d = new Date('2026-10-04T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + i);
    const date = d.toISOString().slice(0, 10);
    daily.time.push(date);
    daily.weatherCode.push(code);
    daily.temperatureMax.push(21.6);
    daily.temperatureMin.push(11.2);
    daily.precipitationSum.push(sum);
    daily.precipitationProbabilityMax.push(prob);
    daily.windSpeedMax.push(12);
    daily.uvIndexMax.push(4);
    daily.sunrise.push(`${date}T07:05`);
    daily.sunset.push(`${date}T18:40`);
  }
  const hourly = { time: [], temperature: [], weatherCode: [], humidity: [], precipitationProbability: [], windSpeed: [], isDay: [], dewPoint: [], visibility: [], pressure: [], cloudCover: [] };
  return { current: {}, hourly, daily };
}

const fontFiles = ['400Regular', '600SemiBold', '800ExtraBold'].map((w) => `src/assets/og-fonts/Figtree_${w}.ttf`);

test('today pages share today, every other page shares tomorrow', () => {
  assert.equal(ogDayIndex('bugun'), 0);
  assert.equal(ogDayIndex('saatlik'), 0);
  for (const p of ['base', 'yarin', '7gun', '10gun', '15gun']) assert.equal(ogDayIndex(p), 1);
  // Weekend: its first day when that is today (Sat/Sun) or tomorrow (Fri).
  assert.equal(ogDayIndex('haftasonu', '2026-10-10'), 0); // Saturday
  assert.equal(ogDayIndex('haftasonu', '2026-10-11'), 0); // Sunday
  assert.equal(ogDayIndex('haftasonu', '2026-10-09'), 1); // Friday
  assert.equal(ogDayIndex('haftasonu', '2026-10-08'), null); // Thursday
});

test('image paths carry the date so cached previews never look current', () => {
  assert.equal(ogImageSlug('kocaeli', null, '2026-10-05'), 'kocaeli-2026-10-05');
  assert.equal(ogImageSlug('kocaeli', 'izmit', '2026-10-05'), 'kocaeli/izmit-2026-10-05');
  assert.equal(ogImageUrl('kocaeli', 'izmit', '2026-10-05'), 'https://yarinhava.com/og/kocaeli/izmit-2026-10-05.png');
});

test('svg shows place, day, forecast and chore verdicts', () => {
  const svg = buildOgSvg({ weather: makeWeather(), dayIndex: 1, title: 'İzmit', provinceName: 'Kocaeli', displayName: 'İzmit' });
  assert.match(svg, />İzmit</);
  assert.match(svg, /Kocaeli · Yarın, 5 Ekim Pazartesi/);
  assert.match(svg, />22°</);
  assert.match(svg, /En düşük 11°/);
  assert.match(svg, /Araç yıkama/);
  assert.match(svg, />Uygun</);
  assert.doesNotMatch(svg, /undefined|NaN/);
});

test('rain turns the verdicts to Ertele and text is XML-escaped', () => {
  const svg = buildOgSvg({ weather: makeWeather({ code: 63, prob: 90, sum: 8 }), dayIndex: 0, title: 'A & B <x>', provinceName: null, displayName: 'A & B' });
  assert.match(svg, /A &amp; B &lt;x&gt;/);
  assert.match(svg, /Bugün, 4 Ekim Pazar/);
  assert.equal((svg.match(/>Ertele</g) ?? []).length, 3);
});

test('renders to a small 1200x630 PNG', () => {
  const svg = buildOgSvg({ weather: makeWeather(), dayIndex: 1, title: 'Kahramanmaraş Merkez', provinceName: 'Kahramanmaraş', displayName: 'Kahramanmaraş Merkez' });
  const img = new Resvg(svg, { font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'Figtree' } }).render();
  assert.equal(img.width, 1200);
  assert.equal(img.height, 630);
  const png = img.asPng();
  assert.deepEqual([...png.subarray(1, 4)], [0x50, 0x4e, 0x47]); // "PNG"
  assert.ok(png.length < 300_000, `${png.length} bytes`);
});
