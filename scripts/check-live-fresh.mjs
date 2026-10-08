#!/usr/bin/env node
/**
 * Is today's forecast already live on production?
 *
 * The site is rebuilt once a day (build-deploy.yml, 00:05 Turkey time). GitHub
 * sometimes delays a scheduled run by hours or drops it entirely, so a second
 * "backup" schedule runs later in the night. That run calls this script first
 * and skips the whole build when production already serves today's data, so
 * Open-Meteo is normally queried once per day, not twice.
 *
 * Writes `fresh=true|false` to $GITHUB_OUTPUT (when set) and always exits 0:
 * any doubt (network error, unexpected HTML) means "not fresh", i.e. build.
 *
 * With `--since-hour H` (the midday refresh) production only counts as fresh
 * when its visible "Son güncelleme" timestamp is today at or after H:00 Turkey
 * time, i.e. the midday fetch already went live.
 *
 * Usage: node scripts/check-live-fresh.mjs [--base https://yarinhava.com] [--since-hour 12]
 */
import { appendFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const baseFlag = argv.indexOf('--base');
const BASE = (baseFlag > -1 ? argv[baseFlag + 1] : 'https://yarinhava.com').replace(/\/$/, '');
const PROBE = '/istanbul-hava-durumu/bugun/';
const sinceFlag = argv.indexOf('--since-hour');
const SINCE_HOUR = sinceFlag > -1 ? Number(argv[sinceFlag + 1]) : null;

/** Hour (0-23) in Istanbul of an ISO instant. */
function istanbulHour(iso) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', hourCycle: 'h23' }).format(new Date(iso)));
}
function istanbulDay(iso) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

function todayInIstanbul() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function output(fresh, why) {
  console.log(`[LIVE] fresh=${fresh} - ${why}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `fresh=${fresh}\n`);
}

try {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  const res = await fetch(`${BASE}${PROBE}?live-check=${Date.now()}`, {
    signal: controller.signal,
    headers: { 'user-agent': 'yarinhava-live-check', 'cache-control': 'no-cache' },
  });
  clearTimeout(timer);
  if (!res.ok) {
    output(false, `${PROBE} returned HTTP ${res.status}`);
  } else {
    const html = await res.text();
    const firstDate = html.match(/data-date="([^"]+)"/)?.[1];
    const today = todayInIstanbul();
    if (firstDate !== today) {
      output(false, `production shows ${firstDate ?? 'no forecast rows'}, today is ${today}`);
    } else if (SINCE_HOUR !== null) {
      const fetched = html.match(/<time datetime="([^"]+)"/)?.[1];
      const ok = fetched && !Number.isNaN(new Date(fetched).getTime())
        && istanbulDay(fetched) === today && istanbulHour(fetched) >= SINCE_HOUR;
      if (ok) output(true, `production data was fetched at ${fetched}, after ${SINCE_HOUR}:00`);
      else output(false, `production data was fetched at ${fetched ?? 'unknown'}, before today ${SINCE_HOUR}:00`);
    } else {
      output(true, `production already shows ${today}`);
    }
  }
} catch (err) {
  output(false, `request failed: ${err.message}`);
}
