import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildBulletin, type Bulletin, type BulletinFacts, type BulletinContext } from './bulletin.ts';
import { loadClimate } from './climate.ts';
import provinces from '../data/provinces.json';
import regions from '../data/regions.json';

/**
 * Every published bulletin, newest first, read from src/data/bulletins/
 * (written by scripts/make-bulletin.mjs and committed by the build workflow).
 */

const DIR = resolve(process.cwd(), 'src/data/bulletins');
const FILE = /^\d{4}-\d{2}-\d{2}\.json$/;

let cache: { facts: BulletinFacts; bulletin: Bulletin }[] | null = null;

export function bulletinContext(): BulletinContext {
  return {
    provinces: provinces as BulletinContext['provinces'],
    regions,
    climate: loadClimate().provinces ?? {},
  };
}

export function loadBulletins(): { facts: BulletinFacts; bulletin: Bulletin }[] {
  if (cache) return cache;
  const ctx = bulletinContext();
  const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => FILE.test(f)).sort().reverse() : [];
  cache = files.flatMap((f) => {
    try {
      const facts = JSON.parse(readFileSync(resolve(DIR, f), 'utf-8')) as BulletinFacts;
      if (facts.version !== 1 || `${facts.date}.json` !== f) return [];
      return [{ facts, bulletin: buildBulletin(facts, ctx) }];
    } catch {
      console.warn(`[BULLETIN] could not read ${f} - skipped`);
      return [];
    }
  });
  return cache;
}
