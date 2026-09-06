# yarinhava.com — SEO recovery, September 2026

Branch: `chatgpt/seo-recovery-2026-09-06`
Baseline compared against: `claude/weather-forecast-site-JpQxB` (production)
Status: safe fixes implemented and committed. **Two URL migrations are
specified below but deliberately NOT implemented — they need sign-off.**

---

## A. Root causes

### A1. Confirmed: five weeks of stale forecasts (primary)

Evidence from this repository, not inference:

| Fact | Source |
|---|---|
| Last commit before the incident: **2026-05-15** | `git log` (`4f99789`) |
| GitHub disables scheduled workflows after 60 days of repository inactivity | GitHub Actions documented behaviour |
| 2026-05-15 + 60 days ≈ **2026-07-14** | arithmetic; matches the reported last good build of ~15 July |
| Site is `output: 'static'`; all forecast data is baked in at build time | `astro.config.mjs`, `src/lib/weather.ts` |
| `getDayName()` labels the first daily row "Bugün" using the **build** date | `src/lib/utils.ts` (pre-fix) |
| Fix landed **2026-08-23** — schedule revived, stale-cache guard added | `b9b21f4`, `656cf65` |
| The workflow that exists today was created **2026-08-23T22:05Z** | GitHub Actions API |

Mechanism: the deployed HTML froze on ~15 July with the 15 July forecast, and
kept presenting 15 July as "Bugün" until 23 August. Nothing failed, so nothing
alerted — there was no failing run to notice, because there were no runs.

The organic collapse begins ~20 August, roughly five weeks into the freeze.
That timing is **consistent with** Google re-crawling and algorithmically
reassessing the site. That causal link is a well-supported hypothesis; it is
not provable from the repository, and nothing here indicates a manual action.

### A2. Confirmed aggravating factors (all verified in code and built output)

Each of these was measured on a real build of the production branch:

1. **Search-intent cannibalisation.** The base location URL was titled
   `"<İl> Hava Durumu - 15 Günlük Tahmin | Yarın Hava"` while a dedicated
   `/15-gunluk/` page existed — and it actually rendered *tomorrow*. Two of our
   own URLs competed for `"<il> hava durumu 15 günlük"`, the exact query family
   that collapsed.
2. **Template duplication.** Measured visible-text similarity between the seven
   templates of one location: base↔`/yarin/` **97.7%**, `/15-gunluk/`↔`/10-gunluk/`
   **96.2%**, `/15-gunluk/`↔`/7-gunluk/` **94.2%**, `/bugun/`↔`/saatlik/` **93.6%**.
   All seven rendered the same four `WeatherSummary` sections and the same four
   FAQs regardless of the range they were about.
3. **`/15-gunluk/` rendered 16 days.** `forecast_days=16` sliced as `slice(0,16)`
   under a "15 Günlük" heading; the FAQ answer said "16 gün ileriye dönük".
4. **27 corrupted district slugs.** `"İ".toLowerCase()` is `"i" + U+0307`; the
   combining dot is not in `[a-z0-9]`, so `İzmit → i-zmit`, `İnegöl → i-negol`,
   `İskenderun → i-skenderun`. Circumflex vowels were dropped entirely.
5. **Sitemap `lastmod: new Date()` on all 7,356 URLs**, every deploy — including
   the privacy policy. No trustworthy freshness signal anywhere.
6. **No visible freshness signal at all.** Nothing on any page told a reader (or
   us) how old the forecast was. `dateModified` was the build date.
7. **51 pages titled "Merkez Hava Durumu"** (× 7 templates = 357 pages), plus 24
   district names shared across provinces producing duplicate titles.
8. **4 empty `<div>`s per page** where ad units should be — no `<ins class="adsbygoogle">`
   anywhere, so monetization depended entirely on Auto Ads.
9. **Hardcoded locative suffixes** in period descriptions: "Uşak'de" instead of
   "Uşak'ta".
10. **~4.5 KB of byte-identical inline JS** duplicated in three templates, on
    every one of ~7,300 pages.

### A3. Timing context

The collapse also coincides with the August 2026 spam update. Treating this as
an algorithmic quality reassessment — stale content plus thousands of highly
similar programmatic pages plus overlapping intents — is consistent with both
the repository evidence and the GSC pattern (position 9.8 → 13.8 with CTR
roughly unchanged; loss of long-tail query diversity, 23 → 5 queries above
1,000 impressions). No penalty is assumed or implied.

### A4. Reliability findings not previously reported

- **Scheduled runs are late, consistently.** Observed start times for the
  `0 3 * * *` cron: 07:17Z, 07:29Z, 07:36Z, 08:11Z — 4–5 hours late, i.e. the
  "06:00 Turkey" build actually lands 10:30–11:00 Turkey time. The `0 17 * * *`
  cron lands 18:41Z–19:34Z. This is normal GitHub scheduling lag under load.
  The freshness SLA is now enforced by the health check rather than assumed
  from the cron expression.
- **A run was cancelled on 2026-09-02** (`33603949640`, ~30 min) and nothing
  reported it.
- **No alerting existed** on build failure, deploy failure, or the site going
  stale.

---

## B. Severity-ranked issues and status

| # | Issue | Severity | Status |
|---|---|---|---|
| 1 | Stale forecasts can be published silently | Critical | **Fixed** — freshness gate + build validator + post-deploy smoke test + independent 6-hourly watchdog + issue-on-failure |
| 2 | Base URL competes with `/15-gunluk/` for the collapsed query family | Critical | **Fixed** — intent ownership is explicit; base no longer claims 15-day |
| 3 | `/15-gunluk/` showed 16 days | High | **Fixed** — 15 rows, asserted by test |
| 4 | 92–98% duplication across seven templates per location | High | **Fixed** — period-specific data-driven content; see §D |
| 5 | base ↔ `/yarin/` are the same page (1,050 URLs) | High | **Pending approval** — Migration A |
| 6 | 27 corrupted district slugs (189 URLs) | High | **Pending approval** — Migration B |
| 7 | Sitemap lied about `lastmod` on 7,356 URLs | High | **Fixed** |
| 8 | No freshness signal to readers or to Google | High | **Fixed** — visible "Son güncelleme" + JSON-LD `dateModified`, both from the real fetch time |
| 9 | Trailing-slash duplicates served with 200 | High | **Not verifiable from here** — see §H |
| 10 | 357 pages titled "Merkez …"; 98 districts with ambiguous titles | Medium | **Fixed** |
| 11 | Ineligible FAQPage + Speakable schema; relative breadcrumb URLs | Medium | **Fixed** |
| 12 | Turkish locative errors in generated meta | Medium | **Fixed** |
| 13 | Empty ad placeholders; Auto-Ads-only monetization | Medium | **Fixed** (placeholders removed, real units ready); density decisions deferred |
| 14 | ~4.5 KB duplicated inline JS/page; render-blocking font | Medium | **Fixed** |
| 15 | Keep-alive was `continue-on-error` (silent) | Medium | **Fixed** |
| 16 | `MIN_COVERAGE` 0.5 lets a degraded build publish | Medium | **Fixed** — 0.85, applied to the cache-reuse paths too |
| 17 | Batch cursor bug in `fetch-weather.mjs` skipped/refetched locations | Low | **Fixed** |
| 18 | No tests | Medium | **Fixed** — 33 tests |
| 19 | Consent Mode carried a legal determination in a code comment | Low | **Fixed** — behaviour unchanged, claim removed, flagged for counsel |

---

## C. URL inventory

| Template | Province | District | Total |
|---|---:|---:|---:|
| base (`/{loc}/`) | 81 | 969 | 1,050 |
| `/bugun/` | 81 | 969 | 1,050 |
| `/yarin/` | 81 | 969 | 1,050 |
| `/7-gunluk/` | 81 | 969 | 1,050 |
| `/10-gunluk/` | 81 | 969 | 1,050 |
| `/15-gunluk/` | 81 | 969 | 1,050 |
| `/saatlik/` | 81 | 969 | 1,050 |
| **Location URLs** | **567** | **6,783** | **7,350** |
| + home + 5 informational pages | | | **7,356** |
| + `/404.html` + `/admin/` (not in sitemap) | | | 7,358 built |

Before and after the safe fixes: **7,358 pages built, 7,356 sitemap URLs — unchanged.**
No URL was added, removed, redirected or noindexed.

---

## D. Measured effect of the safe fixes

Main-content similarity (SequenceMatcher over `<main>` text, SVG and script
stripped), Kocaeli:

| Pair | Before | After |
|---|---:|---:|
| `/15-gunluk/` ↔ `/10-gunluk/` | 96.2% | **58.9%** |
| `/15-gunluk/` ↔ `/7-gunluk/` | 94.2% | **54.7%** |
| `/7-gunluk/` ↔ `/10-gunluk/` | — | 60.8% |
| `/bugun/` ↔ `/saatlik/` | 93.6% | **24.4%** |
| `/15-gunluk/` ↔ `/saatlik/` | 92.5% | **17.3%** |
| `/bugun/` ↔ `/yarin/` | — | 42.1% |
| base ↔ `/yarin/` | 97.7% | 98.9% — *same intent; Migration A* |

The residual similarity is shared navigation chrome (header, the 81-province
footer, district lists, current conditions), which is expected and correct.

Page weight: average HTML per page **77.8 KB → 75.2 KB**, and ~4.5 KB of
per-page inline JS became one cached external file, so multi-page sessions
(the normal pattern here) transfer substantially less.

Sitemap: 7,351 forecast URLs carry a real `lastmod`; 5 informational pages
carry none; `changefreq` and `priority` removed entirely.

---

## E. Files changed

| Commit | Files |
|---|---|
| `fix(seo): normalize Turkish slugs…` | `src/lib/slug.ts` (new), `src/lib/utils.ts`, `tests/slug.test.mjs`, `tsconfig.json` |
| `fix(ads): render real AdSense units…` | `src/components/AdSlot.astro` |
| `perf: extract the duplicated refresh script…` | `public/scripts/weather-refresh.js` (new), `src/layouts/BaseLayout.astro` |
| `feat(content): differentiate forecast period pages…` | `src/lib/periodSummary.ts` (new), `src/components/PeriodInsights.astro` (new), `tests/summary.test.mjs` |
| `fix(seo): resolve canonical search-intent conflicts…` | `src/lib/periods.ts`, `src/lib/seo.ts`, `src/lib/weather.ts`, `src/lib/freshness.ts` (new), `src/layouts/ForecastLayout.astro`, `src/components/{ForecastFreshness,RelatedForecasts,DistrictSiblings}.astro` (new), `src/components/{PeriodTabs,CurrentWeather,DailyForecast,HourlyForecast}.astro`, all four location routes, `src/pages/index.astro`, `tests/periods.test.mjs`; deletes `WeatherSummary.astro`, `ForecastTabs.astro` |
| `fix(seo): make sitemap lastmod…` | `astro.config.mjs` |
| `fix(ci): harden weather freshness…` | `scripts/{fetch-weather,validate-build,smoke-test,make-fixture-cache}.mjs`, `.github/workflows/{build-deploy,health-check}.yml`, `package.json` |

---

## F. PENDING APPROVAL — Migration A: consolidate `/yarin/` into the base URL

**Do not deploy without sign-off.**

### Proposed change
The base location URL already *is* the tomorrow page — it renders tomorrow's
hourly strip and tomorrow's daily row, and the brand is "Yarın Hava".
`/yarin/` is a second URL for the same intent, now measured at **98.9%**
identical to the base URL.

1. Stop linking to `/yarin/` internally (period tabs, related-forecast blocks).
2. `301 /{location}/yarin/ → /{location}/` for every location.
3. Remove `/yarin/` from the sitemap in the same deploy.
4. Keep the redirect permanently — no chains, one hop.

### Affected URL count
| | |
|---|---:|
| Province `/yarin/` URLs | 81 |
| District `/yarin/` URLs | 969 |
| **Total redirected** | **1,050** |
| Sitemap URLs after | 6,306 (from 7,356) |
| Pages built after | 6,308 (from 7,358) |

Netlify implementation is two rules, not 1,050 — the path shape is regular:

```toml
[[redirects]]
  from = "/:province-hava-durumu/yarin/"
  to = "/:province-hava-durumu/"
  status = 301
  force = true

[[redirects]]
  from = "/:province/:district-hava-durumu/yarin/"
  to = "/:province/:district-hava-durumu/"
  status = 301
  force = true
```
(Netlify placeholders do not match partial path segments, so these need to be
written as `/:province/yarin/` style splat rules against the real path shape —
the exact form must be verified on a Netlify **deploy preview** before going to
production. See "Validation required" below.)

### Expected SEO effect
- **Intended:** one URL owns "yarın hava durumu" per location; link equity from
  `/yarin/` consolidates into the stronger base URL; 1,050 near-duplicate pages
  leave the index; crawl budget shifts to the pages we want ranked.
- **Risk:** `/yarin/` URLs currently hold rankings and possibly backlinks. A
  301 passes that equity, but there is a re-evaluation period (typically weeks)
  during which those queries can dip before the base URL absorbs them.
- **This is the riskiest change in this document.** It should not ship in the
  same deploy as Migration B, and arguably not until the freshness fixes have
  had 2–3 weeks to take effect.

### Required before deciding
Export from Search Console (last 16 months, Page filter `contains /yarin/`):
clicks, impressions and top queries. If `/yarin/` pages carry meaningful
independent traffic or backlinks, the alternative is to keep them and instead
differentiate the base page towards "current conditions + this week", leaving
`/yarin/` as the pure tomorrow page. I can implement either.

### Rollback
Delete the two redirect rules and restore `/yarin/` to the sitemap; the pages
are still generated from the same templates, so a single revert commit plus one
deploy restores the previous state. Rollback gets harder the longer the
redirects have been live, because Google will have consolidated the URLs.

---

## G. PENDING APPROVAL — Migration B: correct the 27 malformed district slugs

**Do not deploy without sign-off.**

### Proposed change
Regenerate `src/data/districts.json` with the fixed slugifier and add permanent
redirects from every old path.

### Affected URL count
27 districts × 7 templates = **189 URLs redirected, 189 new URLs created.**
Net sitemap change: 0.

| Old | New |
|---|---|
| `/kocaeli/i-zmit-hava-durumu/` | `/kocaeli/izmit-hava-durumu/` |
| `/bursa/i-negol-hava-durumu/` | `/bursa/inegol-hava-durumu/` |
| `/hatay/i-skenderun-hava-durumu/` | `/hatay/iskenderun-hava-durumu/` |
| `/samsun/i-lkadim-hava-durumu/` | `/samsun/ilkadim-hava-durumu/` |
| `/van/i-pekyolu-hava-durumu/` | `/van/ipekyolu-hava-durumu/` |
| …and 22 more | (full list: `node -e` snippet in the commit for `slug.ts`, or run the generator) |

Full list of affected district slugs is frozen in `tests/slug.test.mjs`
(`KNOWN_LEGACY_SLUGS`), which fails if the data changes without that list being
updated.

Each redirect is one hop, generated programmatically from the old→new slug map
— 27 base rules plus a splat for the period segment, not 189 hand-written rules.

### Expected SEO effect
- **Intended:** clean, human-readable, keyword-matching URLs; `i-zmit` currently
  fails to contain the token "izmit" that users search for.
- **Risk:** these URLs are indexed and ranking *now*. The gain is cosmetic and
  marginal — Google handles ugly slugs fine — while the risk is real ranking
  churn on 27 districts, several of them significant (İzmit, İnegöl,
  İskenderun, İlkadım/Samsun, İpekyolu/Van).
- **My recommendation: do not do this now.** The slugifier is fixed so no *new*
  malformed URL can be created, which captures nearly all the value. Defer the
  migration until organic traffic has recovered and stabilised, then do it as an
  isolated change with nothing else in the deploy.

### Rollback
Revert the `districts.json` regeneration and keep the redirects in place
(harmless once the new URLs 404 — but leaving both directions live would create
a loop, so a rollback must remove the redirects in the same deploy).

---

## H. Not verifiable from this session

This session's egress policy blocks `yarinhava.com` and `api.open-meteo.com`
(HTTP 403 at the proxy for every request, `curl` and `WebFetch` alike). The
following therefore could **not** be checked against production and are stated
as unresolved, not as passing:

1. **Trailing-slash and host canonicalisation (§6 of the brief).** GSC shows both
   `/15-gunluk` and `/15-gunluk/` receiving impressions. Astro emits
   `/path/index.html`; whether Netlify 301s `/path` → `/path/` depends on the
   project's **Pretty URLs** post-processing setting, which is a Netlify UI
   setting and **cannot be expressed in `netlify.toml`** (its redirect matcher
   cannot distinguish "no trailing slash" from the directory itself — a naive
   rule loops). I deliberately did not add a speculative redirect rule I could
   not test, because a wrong one takes production down.
   **Action for you:** confirm in Netlify → Project configuration → Build &
   deploy → Post processing that *Pretty URLs* is ON, and check
   `https://yarinhava.com/kocaeli-hava-durumu/15-gunluk` returns a single 301.
   `npm run smoke` asserts exactly this and will tell you.
2. **http → https and www → non-www.** Netlify handles both by default when the
   domain is configured there; unverified from here.
3. **Live AdSense behaviour** — whether Auto Ads is serving, anchor/vignette
   density, real CLS/INP impact.
4. **Core Web Vitals field data.** The changes here (−2.6 KB HTML/page, one
   cached JS file instead of three inline copies, non-blocking font) are
   directionally positive for LCP and TBT but I have no before/after
   measurement. Run PageSpeed Insights on
   `/kocaeli-hava-durumu/15-gunluk/` (mobile) before and after deploy.
5. **The build was validated against a synthetic forecast fixture**
   (`scripts/make-fixture-cache.mjs`), because Open-Meteo is also blocked. The
   fixture has the exact shape of real data and the build+validator ran clean
   on 7,358 pages, but the first real build in CI is the true test. The
   validator refuses to treat synthetic data as deployable, so this cannot leak
   into production.

---

## I. Validation performed

```
npm test                # 33 tests, 33 pass
npm run build:offline   # 7,358 pages built; validator OK (1 warning: synthetic fixture)
```

The validator checks, for 13 representative locations × 7 templates (91 pages —
İstanbul, Ankara, İzmir, Kocaeli, Bartın, Adıyaman, Zonguldak, İzmit, İnegöl,
İskenderun, Ereğli/Zonguldak, Adıyaman Merkez, Şişli):

HTTP-buildable, exactly one `<h1>`, non-empty title ≤75 chars, meta description
80–165 chars, canonical present/absolute/self-referencing/unique, no `noindex`,
valid JSON-LD with a real `dateModified` and absolute breadcrumbs, the right
number of forecast rows per template, the first forecast date equal to today
(or tomorrow for tomorrow-owning templates), no hourly cell in the past, no
internal link to an unbuilt page, no internal link missing a trailing slash,
sitemap with no duplicates / no `/admin/` / every URL built, robots.txt intact.

---

## J. Manual actions for you

### Immediately after deploy
1. Run `npm run smoke` (or trigger the *Production health check* workflow) —
   it verifies the deploy is live, current, and canonical.
2. Confirm Netlify **Pretty URLs** is on (§H1).
3. PageSpeed Insights, mobile, on the homepage and
   `/kocaeli-hava-durumu/15-gunluk/`.

### Search Console
- **Resubmit `sitemap-index.xml`** — after this deploy, not before.
- **Request indexing for these only** (do not bulk-submit):
  1. `https://yarinhava.com/`
  2. `https://yarinhava.com/kocaeli-hava-durumu/15-gunluk/`
  3. `https://yarinhava.com/bartin-hava-durumu/15-gunluk/`
  4. `https://yarinhava.com/adiyaman-hava-durumu/15-gunluk/`
  5. `https://yarinhava.com/kocaeli/i-zmit-hava-durumu/15-gunluk/`
  6. `https://yarinhava.com/zonguldak/eregli-zonguldak-hava-durumu/15-gunluk/`
  7. `https://yarinhava.com/kocaeli-hava-durumu/`
- **Export before deciding on Migration A:** Pages report, last 16 months,
  filter `URL contains /yarin/`.

### Decisions I need from you
1. Migration A (`/yarin/` → base, 1,050 redirects): proceed, defer, or take the
   alternative in §F?
2. Migration B (27 slugs, 189 redirects): my recommendation is defer.
3. Legal review of the `analytics_storage: 'granted'` default (§B19). This is
   not an engineering call and I have not changed the behaviour.

---

## K. Monitoring plan

**Automated, already in place:**
- Every 6h: `health-check.yml` probes 12 live pages and fails if the forecast is
  >26 h old, if the sitemap has <7,000 URLs, if any sample page is not 200/
  canonical/single-H1, or if GA4/AdSense scripts are missing. Opens a GitHub
  issue labelled `production-stale`.
- Every build: tests → freshness gate (≥85% coverage, forecast must start today)
  → build validator → deploy → post-deploy smoke test. Any failure opens an
  issue labelled `deploy-failure`.
- Keep-alive warns at 45 days and fails the job if it cannot push.

**Manual review cadence:**

| Day | What to check |
|---|---|
| **7** | GSC Coverage: no new "Duplicate without user-selected canonical" or "Crawled – currently not indexed" spike. Impressions on `/15-gunluk/` pages trending up. Confirm ≥14 successful deploys and zero open `production-stale` issues. |
| **14** | Average position for the target query family (`kocaeli/bartın/adıyaman hava durumu 15 günlük`). Count of queries above 1,000 impressions (baseline: fell 23 → 5). CWV field data in GSC. |
| **28** | Clicks and impressions vs the 12–18 August pre-collapse window. Query diversity. If `/15-gunluk/` has recovered but base URLs have not, that is the signal to revisit Migration A. |

Recovery from an algorithmic quality reassessment is typically measured in
Google's re-evaluation cycles, not days. Expect the freshness and duplication
fixes to need one to two full crawl-and-reassess cycles before they show up.
