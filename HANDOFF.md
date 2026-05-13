# HANDOFF — Scorpion CMS → WordPress conversion tool

A pickup-where-we-left-off doc for the next session. Read this **after** `CLAUDE.md` (which carries the project orientation and design principles) and **before** writing code.

---

## 1. What's working today

End-to-end conversion runs through a single `POST /api/jobs` call: ingest → crawl → parse → build → zip. The frontend landing form drives it and exposes a download link.

| Pipeline stage | State | Lives in |
|---|---|---|
| Legacy framework pre-check | **deferred** (see §5) | — |
| Step 0 — `/wp-converter/` ingest | done | `backend/src/pipeline/ingest/` |
| Step 1 — Puppeteer crawl | done (4-worker concurrency, 30s timeout/page) | `backend/src/pipeline/crawl/` |
| Step 2/3 — Stylesheet + JS dedup, inline `<style>` capture | done | `backend/src/pipeline/parse/assets.ts` |
| Step 4 — Content zones | done (ID-based, in DOM order, placeholder substitution) | `backend/src/pipeline/parse/content-zones.ts` |
| Step 5 — Navigation analysis | done (variant detection via fingerprint) | `backend/src/pipeline/parse/navigation.ts` |
| Step 6 — Media discovery | done (incl. `data-src` / `data-srcset` lazy-load attrs) | `backend/src/pipeline/parse/media.ts` |
| Step 6 — Media download + URL map | done (concurrent, filename collision suffixes) | `backend/src/pipeline/download/media.ts` |
| Step 7 — Forms | done (AJAX filter via `data-search="1"`, structural fingerprint variant analysis) | `backend/src/pipeline/parse/forms.ts` |
| WP build — CSS/JS download | done | `backend/src/pipeline/download/assets.ts` |
| WP build — URL rewriting (HTML + CSS + lazy-load `data-src`) | done | `backend/src/pipeline/build/url-rewriter.ts` |
| WP build — Theme files (`style.css`, `functions.php`, `index.php`) | done | `backend/src/pipeline/build/theme.ts` |
| WP build — Page hierarchy (post_parent linking, nested URLs) | done | `backend/src/pipeline/build/hierarchy.ts` |
| WP build — Per-page PHP templates | done (per-zone `[scorpion_zone id]` shortcode at each original DOM slot) | `backend/src/pipeline/build/templates.ts` |
| WP build — WXR XML (pages + nav menu + zone postmeta + `_wp_page_template`) | done | `backend/src/pipeline/build/wxr.ts` |
| WP build — Migration checklist | done | `backend/src/pipeline/build/checklist.ts` |
| WP build — Zip | done (archiver v7, pinned — see §5) | `backend/src/pipeline/build/zip.ts` |
| Route — `POST /api/jobs` (enqueue, returns 202 + jobId) | done | `backend/src/routes/jobs.ts` |
| Route — `GET /api/jobs/:id` (status snapshot) | done | same |
| Route — `GET /api/jobs/:id/export` (stream zip) | done | same |
| Async pipeline — BullMQ worker (in-band, concurrency 1, 3-attempt retry w/ exponential backoff) | done | `backend/src/queue/worker.ts` + `backend/src/pipeline/run.ts` |
| Frontend — landing form (redirects to `/job/[id]`) | done | `frontend/components/job-start-form.tsx` |
| Frontend — progress page (WebSocket `snapshot` + `update` stream, polling fallback) | done | `frontend/app/job/[id]/job-progress.tsx` |
| WebSocket route — `/api/jobs/:id/events` (snapshot on connect, updates on transition, code 1000 on terminal) | done | `backend/src/routes/jobs-ws.ts` + `backend/src/queue/events.ts` |

### Verified on the canonical test site
`https://www.tennesseeplumbinginc.com/` — runs in ~30–45 s, produces a ~4.7 MB zip with 204 files (88 page templates, 23 stylesheets, 55 JS files, 19 media files, valid WXR XML, migration checklist).

---

## 2. How to run

Three terminals — Docker (Postgres + Redis), backend on `:3001`, frontend on `:3000`.

```
# Once per machine (Docker Desktop must be running)
cp backend/.env.example backend/.env   # one-time; matches docker-compose defaults
docker compose up -d                   # Postgres + Redis (app data plane)
# → containers `scorpion-wp-converter-postgres` and `…-redis`

# Terminal 1 — backend
cd backend && npm run dev
# → "Backend listening on http://localhost:3001"
#   On boot, the backend runs `drizzle/` migrations against $DATABASE_URL.

# Terminal 2 — frontend
cd frontend && npm run dev
# → "✓ Ready in <n>ms" — open http://localhost:3000
```

### Database / queue commands
```
npm run db:generate                 # generate a new migration after editing src/db/schema.ts
npm run db:migrate                  # apply pending migrations (the backend also does this on boot)
npm run db:studio                   # drizzle-kit studio against the local DB
docker compose down                 # stop services (volumes persist)
docker compose down -v              # stop + wipe the local DB
```

### Local WordPress for end-to-end validation
A second docker-compose service group (WordPress 6.7 + MariaDB 11 + wp-cli) lets you import a generated zip into a real WP install and visually compare it to the original Scorpion site.

```
docker compose up -d wpdb wordpress   # WP at http://localhost:8080
cd backend
npm run wp:import                     # imports the most-recent ready job into WP
npm run wp:import -- --clean          # wipes existing content first, then imports
npm run wp:import -- <jobId>          # import a specific job by id
```
The script installs WordPress (if not installed), activates the generated `scorpion-converted` theme, copies media into `wp-content/uploads/scorpion-migration/`, installs the `wordpress-importer` plugin, runs the WXR import, and pins the imported "home" page as `show_on_front`. Default credentials are `admin` / `admin` at `http://localhost:8080/wp-admin/`.

### CLI alternative — runs the full pipeline including the build
```
cd backend
npx tsx src/scripts/run-extract.ts https://www.tennesseeplumbinginc.com/            # pipeline + analysis prints
npx tsx src/scripts/run-extract.ts https://www.tennesseeplumbinginc.com/ --download # also downloads media to a temp dir
```

Other CLIs (subsets):
- `npx tsx src/scripts/run-ingest.ts <url>` — Step 0 only
- `npx tsx src/scripts/run-crawl.ts <url>` — Step 0 + Step 1

### Quick smoke checks (backend up)
```
curl http://localhost:3001/health
# → {"status":"ok"}

curl -s -X POST http://localhost:3001/api/jobs \
  -H "Content-Type: application/json" \
  -d '{"siteUrl":"https://nope.invalid","siteTitle":"x","uscVersion":"USC 4.0"}'
# → {"error":"...","category":"network","retryable":true}  HTTP 502
```

---

## 3. Where things live

```
backend/
  drizzle/                 # Generated migrations (commit these)
  drizzle.config.ts        # drizzle-kit config — points at src/db/schema.ts
  .env.example             # Matches docker-compose defaults
src/
  config/
    env.ts                 # Reads DATABASE_URL / REDIS_URL / PORT / TEMP_DIR
    usc-versions.ts        # USC_VERSIONS const + UscVersion type — SOLE source of truth
  db/
    schema.ts              # drizzle schema: `jobs` table + `job_status` pgEnum
    client.ts              # pg Pool + drizzle instance + runMigrations()
    job-store.ts           # DB-backed: createJob / updateJob / getJob via drizzle
  pipeline/
    ingest/                # Step 0
    crawl/                 # Step 1 (Puppeteer)
    parse/                 # Steps 2/3 (assets), 4 (content zones), 5 (nav), 6 (media), 7 (forms)
    download/              # Media + CSS/JS download
    build/                 # WP packaging
    run.ts                 # runConversion(): single pipeline orchestration the worker calls
  queue/
    index.ts               # BullMQ Queue + shared ioredis connection + QUEUE_NAME
    worker.ts              # Worker (concurrency 1, 3-attempt retry w/ exponential backoff)
    events.ts              # In-process JobEventBus — publishJobUpdate / subscribeJob
  routes/
    jobs.ts                # POST /api/jobs (enqueue, 202) + GET /:id + GET /:id/export
    jobs-ws.ts             # WebSocketServer attached to the HTTP `upgrade` event
  scripts/
    run-ingest.ts          # Step 0 only
    run-crawl.ts           # Steps 0 + 1
    run-extract.ts         # Full pipeline; --download to also fetch media
    run-migrations.ts      # `npm run db:migrate` entry point
    import-to-wp.ts        # `npm run wp:import` — push the latest zip into the local docker WP
  index.ts                 # Express entry — runs migrations on boot then starts the server

frontend/
  app/page.tsx             # Landing route (server component)
  app/job/[id]/page.tsx    # SSR shell that renders <JobProgress jobId=…>
  app/job/[id]/job-progress.tsx  # Client component — polls GET /api/jobs/:id, renders stage list + download
  app/job/[id]/{review,preview,export}/...  # Placeholders for the eventual wizard
  components/job-start-form.tsx  # Client — POST /api/jobs then router.push(`/job/[id]`)
  lib/usc-versions.ts      # MIRROR of backend USC_VERSIONS (keep in sync; will collapse to API later)
  next.config.mjs          # Rewrites /api/* → http://localhost:3001/api/*
```

Project docs at the repo root: `SPEC.md`, `ARCHITECTURE.md`, `EXTRACTION.md`, `WORDPRESS-OUTPUT.md`, `DECISIONS.md`, `CLAUDE.md`. Always read `CLAUDE.md` first.

---

## 4. Recent commit timeline

The latest meaningful commits (newest first). `git log --oneline` for the full list.

- `65a6f78` merge nav-init — brings Step 5 onto master
- `7648753` WordPress packaging end-to-end + wire pipeline into `/api/jobs`
- `0273731` media download (Step 6 second half)
- `9f181e8` media discovery (Step 6, discovery only)
- `0fa4b0f` form extraction (Step 7) with AJAX filter + variant analysis
- `421ff27` stylesheet + JS dedup + inline-style capture
- `44e845e` filter `/wp-converter/` from ingested page list
- `0ff428f` content-zone extraction (Step 4) + pin test site
- `a93fc20` Puppeteer per-page crawler (Step 1)
- `ab903d0` wire landing form to backend ingest via in-memory job store
- `f31ea65` constrain USC version to dropdown + landing form
- `1050f9d` backend scaffold + `/wp-converter/` ingest

---

## 5. Known limitations / things to surface in any new session

1. ~~**Single `the_content()` per template.**~~ Resolved by the `[scorpion_zone id="…"]` shortcode. Each placeholder in the template now becomes `<?php echo do_shortcode('[scorpion_zone id="<zoneId>"]'); ?>`, and each zone's HTML is written to a per-page postmeta key `_scorpion_zone_<zoneId>` in the WXR. `functions.php` registers a shortcode handler that reads the meta. Verified on the test site: 89 pages × 673 total zones, each shortcode call placed at its original DOM position (e.g. home page has 17 zones spread across its sections, not stacked at one slot). Tradeoff: `post_content` is empty, so editing a zone from the standard WP editor isn't possible — use a Custom Fields plugin / ACF group, or revisit if editor-native editing matters more than placement accuracy.

2. **Nav menus emitted as `custom`-type items.** WXR now contains the dominant nav variant as a `primary-menu` `<wp:term>` plus one `nav_menu_item` per `NavItem`. Items use `_menu_item_type=custom` with `_menu_item_url` set to the (relative) href, and depth → parent linkage via `_menu_item_menu_item_parent`. Hrefs that match internal pages are *not* linked to those pages' post_ids — they resolve at request time via the URL. Upgrading those to `_menu_item_type=post_type` / `_menu_item_object=page` references would give cleaner admin UX (menu items show as "Home", "About", etc., not raw URLs), but is a follow-up. Multi-variant nav still picks `variants[0]` (the most common) — the review wizard will need to surface a chooser when more than one variant is present.

3. ~~**Synchronous `POST /api/jobs` blocks 30–90 s.**~~ Resolved in Slices 3+4. POST returns 202 in <100 ms; the BullMQ worker runs the pipeline; the frontend subscribes to `ws://…/api/jobs/:id/events` and reacts in real time. Polling remains as a fallback for any non-1000 close.

4. ~~**In-memory job store resets on backend restart.**~~ Resolved in Slice 2. `db/job-store.ts` now reads/writes the `jobs` table via drizzle. Re-verified end-to-end: a job inserted in one backend process is downloadable after the process restarts.

5. **Legacy framework pre-check deferred.** `EXTRACTION.md` describes the lightweight HTTP fingerprint that should run before ingest to confirm USC-vs-non-USC and reject non-Scorpion sites cleanly. We chose to **omit this for now** — the tool currently assumes the user knows they're pointing at a USC site (the dropdown enforces the supported version floor) and will produce garbage if pointed at a non-USC site without a clear error. Implement when we want a friendlier rejection path.

6. **Scorpion-CDN scripts dropped today.** `analytics.scorpion.co`, `sc-connect.scorpion.co`, `api.scorpion.co` all fail the strict same-host filter and end up in the `excluded` lists. `sc-connect` may include real interactive widgets we want to keep. The right place to address this is the eventual review wizard (let the user opt back in per script). For now, the excluded lists are surfaced in `run-extract.ts` so you can see what's dropped.

7. **`archiver` is pinned to v7 in `backend/package.json`.** v8 is ESM-only with class exports (`ZipArchive`) that don't match `@types/archiver` v7 and don't survive tsx's CJS transpilation cleanly. If you upgrade `@types/archiver` to v8 (when it exists) and re-test, you can bump archiver too. Until then, hold the pin.

8. **`USC_VERSIONS` is duplicated** between `backend/src/config/usc-versions.ts` and `frontend/lib/usc-versions.ts`. There's a sync comment in the frontend file. The right collapse is an API endpoint the dropdown fetches from — defer until needed.

9. **No tests.** No vitest, no fixture HTML for the parsers, no integration test that round-trips a fake site. End-to-end verification today is the `run-extract.ts` CLI + the test site. Worth adding fixture-based unit tests for the parsers (ingest, content-zones, forms, nav) before they accrete more behavior.

10. **Most `frontend/app/job/[id]/...` routes are still placeholder `<main />` files.** The progress page is live (`app/job/[id]/page.tsx` + `job-progress.tsx`), but the review wizard (pages / nav / zones / media / forms / styles), preview, and export flows are still empty. The WebSocket channel from Slice 4 is the natural place to surface per-stage detail for the wizard later (variant counts, excluded scripts, parse timings, etc.).

11. **In-process pub/sub assumes a single backend node.** `queue/events.ts` uses a Node `EventEmitter` — it works because the BullMQ worker and the Express server share a process. If the worker is ever split out (per ARCHITECTURE.md's eventual model), we'll need to switch to Redis pub/sub or BullMQ's `QueueEvents` so updates cross processes.

12. **WebSocket route is not proxied through Next.** Next.js's `rewrites` only proxy HTTP. The browser connects directly to `ws://localhost:3001/api/jobs/:id/events` using `NEXT_PUBLIC_BACKEND_WS_URL` (default `ws://localhost:3001`). When we land behind a reverse proxy in deploy, set that env var to the public WS origin.

13. **Page hierarchy assumes Scorpion's sitemap lists every level.** `pipeline/build/hierarchy.ts` walks paths and links children to parents via `post_parent`. If a Scorpion site has `/a/b/` in the sitemap without `/a/`, the child's `post_parent` falls back to 0 and the URL flattens to `/b/` instead of preserving `/a/b/`. The tennesseeplumbinginc.com test site has no such gaps. If it becomes a real issue, synthesize stub pages for the missing intermediates (out-of-scope for this slice).

14. **SVG sprite icons are not yet downloaded.** Scorpion uses `<use data-href="/cms/svg/site/<id>.svg#flair">` for inline SVG sprites; the discovery pass walks `<img>` and `<source>` data-src/data-srcset but not `<use data-href>`. Visual impact on the test site is small (a few decorative flair shapes); add when it becomes noticeable.

---

## 6. Suggested next moves (pick one)

| Slice | Size | Why |
|---|---|---|
| Review wizard frontend | large | The `frontend/app/job/[id]/review/*` placeholder routes still need real UI. With the WS channel in place we can drive it off live state instead of polling, and per-stage detail can be added to the channel as needed. |
| Fixture-based parser tests | medium | Defensive — locks in current parsing behavior before the surface area grows. Use vitest + saved HTML fixtures from the test site. |
| SVG sprite discovery (`<use data-href>`) | small | The remaining gap from the WP-validation pass. Add a third discovery pass alongside img/source data-src and rewrite at template + zone time. |
| Add legacy framework pre-check | small | The deferred-but-documented stage. Spec is in `EXTRACTION.md`. Useful once we have real non-USC users hitting the tool. |

---

## 7. Conventions worth knowing

- **Commits are intentional slices.** Each commit corresponds to one user-approved scope; commit messages describe the *why*, link to the test-site verification numbers, and call out follow-up work or known gaps. Follow that pattern.
- **CLAUDE.md is authoritative for design principles.** Visual accuracy > convenience. Fully dynamic extraction. One template per page. No pre-built theme library. ID-based content zones, not class-based.
- **`https://www.tennesseeplumbinginc.com/` is the canonical test site** (pinned in `CLAUDE.md`). Use it for every verification. Lazy-loaded image counts vary slightly between crawl runs — that's normal.
- **CRLF warnings on commit are expected.** Working tree uses LF, git stages as CRLF on Windows. Don't fight it.
- **Don't commit without an explicit ask.** Match scope to what was requested.
- **Don't write speculative docs.** Project docs are the SPEC/ARCHITECTURE/EXTRACTION/WORDPRESS-OUTPUT/DECISIONS family; if a fact needs a permanent home, it goes there. Otherwise let `git log` carry the history.
