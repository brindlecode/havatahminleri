import provinces from '../data/provinces.json';
import districts from '../data/districts.json';
import { getLocationPath } from '../lib/periods';

// Coordinates of every location page, for "Konumumu kullan" on the home page
// (public/scripts/locate.js): the browser finds the nearest one itself, so
// the visitor's position never leaves the device. [name, url, lat, lon]
export function GET() {
  const provinceName = new Map(provinces.map((p: any) => [p.slug, p.name]));
  const rows: [string, string, number, number][] = [
    ...provinces.map((p: any): [string, string, number, number] => [p.name, getLocationPath(p.slug), p.lat, p.lon]),
    ...districts.map((d: any): [string, string, number, number] => [
      d.name === 'Merkez' ? `${provinceName.get(d.province)} Merkez` : d.name,
      getLocationPath(d.province, d.slug),
      Math.round(d.lat * 1e4) / 1e4,
      Math.round(d.lon * 1e4) / 1e4,
    ]),
  ];
  return new Response(JSON.stringify(rows), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
