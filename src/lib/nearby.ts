import districtsData from '../data/districts.json' with { type: 'json' };
import provincesData from '../data/provinces.json' with { type: 'json' };
import { getLocationPath } from './periods.ts';
import { getLocationNames } from './seo.ts';

/**
 * Geographic neighbours for internal linking ("Yakındaki ilçeler").
 *
 * Distances are great-circle (haversine) between the real coordinates in
 * src/data/districts.json and provinces.json, so the list crosses province
 * borders: the nearest places to Gebze include Darıca (Kocaeli) and Tuzla
 * (İstanbul) alike.
 */

interface DistrictRow { name: string; slug: string; province: string; lat: number; lon: number }
interface ProvinceRow { name: string; slug: string; lat: number; lon: number }

const DISTRICTS = districtsData as DistrictRow[];
const PROVINCES = provincesData as ProvinceRow[];
const PROVINCE_BY_SLUG = new Map(PROVINCES.map((p) => [p.slug, p]));

export interface NearbyLocation {
  /** Display name: "Tuzla", "Adıyaman Merkez", "Kemer (Burdur)". */
  name: string;
  provinceName: string;
  provinceSlug: string;
  /** District slug. */
  slug: string;
  /** Root-relative landing page, e.g. "/istanbul/tuzla-hava-durumu/". */
  href: string;
  /** Straight-line distance, rounded to whole km. */
  km: number;
}

export interface NearbyProvince {
  name: string;
  slug: string;
  href: string;
  km: number;
}

/** Great-circle distance in km. */
export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const r = Math.PI / 180;
  const h =
    Math.sin(((bLat - aLat) * r) / 2) ** 2 +
    Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLon - aLon) * r) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The `limit` districts nearest to a location, from any province, excluding
 * the location itself. For a province page pass `districtSlug = null`; the
 * origin is then the province centre.
 *
 * Intended use: a "Yakındaki ilçeler" link list on every location page
 * (province and district, all periods), linking to each item's `href`
 * with its `name` and `km`. Returns [] for an unknown slug.
 */
export function getNearbyLocations(
  provinceSlug: string,
  districtSlug: string | null,
  limit = 12,
): NearbyLocation[] {
  let origin: { lat: number; lon: number } | undefined;
  if (districtSlug) {
    origin = DISTRICTS.find((d) => d.province === provinceSlug && d.slug === districtSlug);
  } else {
    origin = PROVINCE_BY_SLUG.get(provinceSlug);
  }
  if (!origin) return [];
  const { lat, lon } = origin;

  return DISTRICTS.filter((d) => !(d.province === provinceSlug && d.slug === districtSlug))
    .map((d) => ({ d, dist: haversineKm(lat, lon, d.lat, d.lon) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, Math.max(0, limit))
    .map(({ d, dist }) => {
      const provinceName = PROVINCE_BY_SLUG.get(d.province)?.name ?? d.province;
      return {
        name: getLocationNames({
          provinceName,
          provinceSlug: d.province,
          districtName: d.name,
          districtSlug: d.slug,
          lat: d.lat,
          lon: d.lon,
        }).display,
        provinceName,
        provinceSlug: d.province,
        slug: d.slug,
        href: getLocationPath(d.province, d.slug),
        km: Math.round(dist),
      };
    });
}

/**
 * The `limit` provinces whose centres are nearest to this province's centre
 * (excluding itself).
 *
 * Intended use: a "Komşu iller" link list on province pages (and optionally
 * district pages, using the district's `provinceSlug`). Returns [] for an
 * unknown slug.
 */
export function getNearbyProvinces(provinceSlug: string, limit = 6): NearbyProvince[] {
  const origin = PROVINCE_BY_SLUG.get(provinceSlug);
  if (!origin) return [];
  return PROVINCES.filter((p) => p.slug !== provinceSlug)
    .map((p) => ({ p, dist: haversineKm(origin.lat, origin.lon, p.lat, p.lon) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, Math.max(0, limit))
    .map(({ p, dist }) => ({
      name: p.name,
      slug: p.slug,
      href: getLocationPath(p.slug),
      km: Math.round(dist),
    }));
}
