# DECISIONS.md — Key Decision Log

A record of significant decisions made during the planning phase and the reasoning behind each. Read this before proposing architectural changes — many options were explicitly considered and rejected.

---

## Extraction approach: Fully dynamic vs. pre-built theme library

**Decision:** Fully dynamic extraction — everything is pulled from the live rendered site.

**Rejected:** Pre-built WordPress theme library mapped to USC/Make/Model combinations.

**Why:**
- Scorpion has hundreds of models and the library is actively growing — maintaining a parallel WordPress theme library creates an unsustainable maintenance burden
- Sites are increasingly customised and diverge significantly from their base model — template mapping produces inaccurate results on heavily customised sites
- Dynamic extraction handles any level of customisation without requiring updates to the tool

---

## USC/Make/Model selection: Removed entirely

**Decision:** The tool does not ask users to select their USC version, Make, or Model. USC version and site title are user-entered informational fields only.

**Rejected:** A wizard step for framework/model selection with a visual picker and admin config system.

**Why:**
- With fully dynamic extraction the framework hierarchy is no longer load-bearing for styling — all styles come from the live site regardless of framework
- Scorpion supplies the JS utilities directly, eliminating the need for per-version plugin mapping
- Removing this eliminates the admin config system, the model library, and associated maintenance burden entirely

---

## CSS strategy: Extract authored stylesheets vs. computed styles

**Decision:** Extract the authored stylesheet bundles directly from the page `<head>`.

**Rejected:** Extracting element-level computed styles via the browser.

**Why:**
- Computed styles are highly verbose and element-level — the resulting CSS is unmaintainable
- Scorpion bundles all CSS server-side at build time — the browser receives clean authored stylesheet files
- Authored stylesheets carry Google Fonts via `@import` naturally — no separate font handling needed
- Simpler implementation with equivalent visual accuracy

---

## Stylesheet enqueuing: Global vs. conditional per page type

**Decision:** All discovered stylesheets are enqueued globally in WordPress — every stylesheet loads on every page.

**Rejected:** Conditional enqueuing based on which page types discovered each stylesheet.

**Why:**
- Visual accuracy and ease of implementation are the top priorities
- Conditional enqueuing requires reliable page type detection and per-type stylesheet mapping — significant added complexity
- The performance cost of globally loading all stylesheets is an acceptable tradeoff for a migration tool
- Can be optimised as a future enhancement

---

## Interactive components: WordPress plugin mapping vs. Scorpion-supplied JS

**Decision:** Extract Scorpion's own JS utilities from the live site and bundle them directly into the WordPress theme.

**Rejected:** Detecting Scorpion utility components and replacing them with WordPress plugin equivalents.

**Why:**
- Scorpion can supply the JS directly — no need to find plugin equivalents
- Plugin mapping requires per-version USC utility lists, DOM detection signatures, and an admin config system — all eliminated by using the original JS
- Using the original JS guarantees functional accuracy — plugin equivalents may not replicate all behaviours

---

## Editable content detection: Verified ID list vs. `.cnt-stl` class

**Decision:** Content zone IDs from `{site_url}/wp-converter/#SiteContentIdsTable` are the sole signal for editable content regions.

**Rejected:** Using the `.cnt-stl` CSS class as the editable content signal.

**Why:**
- `.cnt-stl` is too prone to user error — class names can be misapplied or inconsistently used
- The `/wp-converter/` endpoint provides a verified, authoritative list of content zone IDs directly from the Scorpion CMS — these IDs are ground truth
- ID-based detection is deterministic and reliable — no false positives from misapplied classes

**Also rejected:** Using arbitrary HTML IDs (not from a verified list) as an editable content signal.

**Why:**
- ID usage across Scorpion sites is inconsistent — not all IDs indicate content zones
- Without a verified list, ID-based detection produces false positives on structural and styling IDs

---

## Content zone data source: Database dump vs. per-site endpoint

**Decision:** A dedicated endpoint at `{site_url}/wp-converter/` serves site-specific content zone IDs and page data as HTML tables.

**Rejected:** A centralised database dump of content zone IDs imported into the conversion tool.

**Why:**
- Content zone IDs vary from site to site — a centralised dump would require per-site imports and ongoing maintenance
- A per-site endpoint is always up to date with that site's current configuration
- No database import process, no sync issues, no maintenance burden on the tool

---

## `/wp-converter/` response format: HTML tables vs. JSON

**Decision:** HTML tables (`#SiteMapListTable`, `#SiteContentIdsTable`) served at `/wp-converter/`.

**Rejected:** A JSON API endpoint.

**Why:**
- HTML tables are easier to generate from Scorpion's existing backend
- Cheerio is already in the stack for DOM parsing — parsing HTML tables adds no new dependency
- Table IDs make selection unambiguous and reliable

---

## Page templates: One per page vs. shared templates with overrides

**Decision:** Every page gets its own generated WordPress template regardless of whether pages share a Scorpion template.

**Rejected:** Detecting shared templates, generating one template per template type, and handling page-specific panel overrides on top.

**Why:**
- Page-specific panel overrides in Scorpion's CMS mean pages sharing a template can have meaningfully different content zones — skipping pages based on template sharing risks missing these overrides
- One template per page is simpler to implement, completely predictable, and guarantees accuracy
- The added storage cost of extra template files is negligible

---

## Navigation: Crawler-based vs. endpoint-provided

**Decision:** Navigation is extracted entirely by the crawler from each page's `<nav>` element.

**Rejected:** Serving navigation structure from the `/wp-converter/` endpoint.

**Why:**
- Navigation can vary from page to page on Scorpion sites — the endpoint can't easily represent per-page nav variations
- The crawler visits every page anyway — extracting nav per page adds minimal overhead
- When variations are detected the review wizard surfaces them for user resolution

---

## Media storage: Local temp vs. S3/Cloudflare R2

**Decision:** Local temp directory on the server, auto-deleted after export delivery.

**Rejected:** S3 or Cloudflare R2 for media staging.

**Why:**
- Media is only needed transiently during a conversion job — it does not need to be served or persisted
- Local temp eliminates an external service dependency, reduces cost to zero, and simplifies implementation
- If a site has an unusually large media library exceeding server disk limits, this can be revisited — not an expected common case

---

## Legacy framework support: Detect and reject vs. attempt conversion

**Decision:** Detect legacy (non-USC) frameworks early and surface a clear unsupported message. Do not attempt conversion.

**Rejected:** Best-effort conversion of legacy framework sites.

**Why:**
- Legacy frameworks are structurally different from USC — extraction logic built for USC sites produces unreliable results on legacy sites
- A clean unsupported message is a better user experience than a broken or inaccurate conversion
- Legacy framework support is explicitly deferred — the detection hook provides a natural extension point
