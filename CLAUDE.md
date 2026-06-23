# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## ⚠️ Next.js version notice

This repo runs Next.js 16 (canary-ish, App Router) with React 19. APIs/conventions may differ from training data — check `node_modules/next/dist/docs/` before relying on memory for App Router behavior (route handlers, `after()`, caching/`revalidate` semantics, etc).

## Project

"Affree" (package name `gia-quanh-day`) — a Vietnamese local price-comparison app. Users compare prices for the same product across nearby physical stores (Bách Hóa Xanh, Con Cưng, Co.opmart, AEON) and online sources (Shopee, GrabMart, PNJ, Lotte, etc.), see distance-ranked offers on a map, and place simulated orders. Code comments and domain strings are in Vietnamese; this file and identifiers are in English.

## Commands

```bash
npm run dev          # next dev — local dev server
npm run build         # next build
npm run start         # next start — serve production build
npm run scrape        # tsx scripts/scrape-live.ts — manual live price scrape run
npm run push-real     # tsx scripts/push-real.ts — push real data to the Apps Script sheet
npm run deploy        # bash scripts/deploy.sh — vercel --prod + re-alias affree.vercel.app
```

There is no test runner configured (no `test` script, no test framework in `devDependencies`). Don't assume Jest/Vitest exist.

## Architecture

### Data flow: Google Sheets are the database

There is no traditional database. All product/price/store data lives in published Google Sheets, read directly as exported CSV at request time. Each `lib/sheet-*.ts` file owns one sheet and its own hand-rolled CSV parser (`splitCsv`) — header columns are detected by **name matching**, not position, so sheet column order can change without breaking the app:

- `lib/sheet-catalog.ts` — the "master sheet" (1645+ products, prices, links). `parseMasterCsv` fans a single chain price out to every physical store of that chain (`physicalStoresOfChain`); pure-online sources get one offer against a synthetic store.
- `lib/sheet-stores.ts` — physical store list + lat/lng (tab "stores").
- `lib/sheet-groups.ts` — "tệp" (product group tiles shown on the homepage) and "ưu tiên hiển thị" (per-tile chain display priority).
- `lib/stores.ts` — `SOURCE_META` (per-chain label/color/home URL/currency), `setDynamicStores`/`physicalStoresOfChain` for runtime-loaded store data, search-URL builders.
- `lib/seed-catalog.ts` — static fallback catalog used when every live source fails.

`app/api/catalog/route.ts` is the data-source waterfall consumed by the frontend: sheet-CSV (`CATALOG_CSV_URL`) → `CATALOG_SOURCE=catalog-tab` (Apps Script) → master sheet → Apps Script catalog tab → `SHEET_CSV_URL` → static seed. Each source's response JSON includes a `source` field naming which tier served it — useful when debugging "why is this product/price wrong."

### Google Apps Script as a write backend

`apps-script/Code.gs` is a Google Apps Script Web App (deployed separately, NOT part of the Next.js build) bound to a spreadsheet. It exposes `doGet`/`doPost` actions (`set_catalog`, `upsert_catalog`, `live_upsert`, `add_purchase`, `add_alert`, `save_buyer`) used as a write-back path for data the Next.js server can't write directly to a published-CSV sheet. Its URL is configured via `CATALOG_API_URL` / `PURCHASE_WEBHOOK_URL`. Editing `Code.gs` requires manually redeploying a new Apps Script version (pasting the file into the Apps Script editor) — this repo copy is the source of truth but isn't auto-deployed.

### Live price scraping

`app/api/scrape-live/route.ts` re-scrapes product pages for live price/stock (only `concung` and `coop` are scrapable — others block bots) and writes results back through the Apps Script webhook. It self-chains via `after()` to sweep through all targets within Vercel's per-invocation time budget (`TIME_BUDGET_MS`), tracking progress via `?offset=`. Guarded by `CRON_SECRET`. The single cron in `vercel.json` (`0 0 * * *`) hits `?write=1&all=1` nightly; `/admin` has a manual "scrape now" trigger for a smaller batch. `lib/scrape/live.ts` holds the actual per-URL fetch+parse logic (JSON-LD based).

### Client-side persistence (`lib/*.ts` "use client" modules)

Several `lib/` modules pair localStorage with a fire-and-forget POST to the Apps Script webhook, so the UI always works offline/unconfigured and upgrades to sheet-backed persistence when `PURCHASE_WEBHOOK_URL` is set:
- `lib/profile.ts` — buyer profile (name/phone/address), debounced push to `/api/buyer`.
- `lib/purchases.ts` — purchase history → `/api/purchases`.
- `lib/alerts.ts` — price-drop alert signups → `/api/alerts`.
- `lib/recent.ts` — recently viewed products (local only).

All the corresponding `app/api/*/route.ts` handlers follow the same shape: parse JSON, if `PURCHASE_WEBHOOK_URL` unset return `{ ok: true, persisted: "client-only" }`, else POST to the webhook and report `persisted: "sheet"`.

### Geocoding

`lib/geocode.ts` (client) calls `/api/geocode`, which proxies to Nominatim/OpenStreetMap (free, VN-restricted, requires a `User-Agent`). `/api/geocode/autocomplete` proxies a separate paid-style API (`NEXT_GEO_API_BASE_URL`/`NEXT_GEO_API_KEY`, default `goollow.org`) for address autocomplete. Map tiles come from `NEXT_PUBLIC_MAP_URL`/`NEXT_PUBLIC_MAP_LAYER` (also goollow.org), rendered via `components/MapView.tsx` (Leaflet/react-leaflet).

### i18n

`lib/i18n.ts` uses Vietnamese UI strings as the dictionary *keys* themselves (`tr(lang, "chuỗi VN", vars?)`), with `EN_DICT` providing English translations. Missing English translations silently fall back to the Vietnamese key — never throws. Language is inferred from the user's detected location country code (`langForCountry`), not a manual toggle.

### Other entry points

- `app/admin/page.tsx` — internal dashboard (manual scrape trigger, etc.), no auth beyond what's in the page itself.
- `app/history/page.tsx` — purchase history view, reads `lib/purchases.ts`.
- `scripts/*.ts` / `*.mjs` at repo root (`grab-astrabean.mjs`, `push-astrabean.mjs`, `scripts/push-catalog-csv.mjs`, `scripts/build_catalog.py`) — one-off/ad-hoc data ingestion scripts, run manually, not part of the build or any CI.

## Environment variables

Sheet/data sourcing: `CATALOG_CSV_URL`, `CATALOG_SOURCE` (`catalog-tab` to switch primary source), `CATALOG_API_URL`, `MASTER_SHEET_CSV_URL`, `SHEET_CSV_URL`, `STORES_SHEET_CSV_URL`, `STORES_SHEET_GID`, `TEP_SHEET_CSV_URL`, `PRIORITY_SHEET_CSV_URL`, `PURCHASE_WEBHOOK_URL`.
Scraping: `CRON_SECRET`.
Geo: `NEXT_GEO_API_BASE_URL`, `NEXT_GEO_API_KEY`, `NEXT_PUBLIC_GEO_API_BASE_URL`, `NEXT_PUBLIC_GEO_API_KEY`, `NEXT_PUBLIC_MAP_URL`, `NEXT_PUBLIC_MAP_LAYER`.

All sheet-source URLs have hardcoded defaults pointing at real production spreadsheets, so the app works with zero env config out of the box — env vars only override which sheet/source is used.
