# SPEC.md — Product Specification
**Scorpion CMS → WordPress Conversion Tool**
Version 1.1 | Planning Phase Complete

---

## 1. Overview

A web-based tool that converts live Scorpion CMS sites into fully functional WordPress sites. Serves both technical and non-technical Scorpion users. Extracts everything dynamically from the live rendered site — no pre-built templates, no theme library, no framework mapping.

---

## 2. Scorpion Site Context

Scorpion sites follow a three-tier hierarchy:

```
USC Version → Make → Model
```

| Layer | Role |
|---|---|
| USC Version (e.g. USC 4.2) | Core CSS framework + shared JS utilities |
| Make | Visual styling tweaks — gives the design its flair |
| Model | Tied to a business vertical (Legal, Medical, Home Services, etc.) |

**Important:** This hierarchy is informational context only. It does not drive any part of the conversion logic. All styles and JS are extracted dynamically from the live site regardless of which layer they originated from.

### CSS delivery
- All CSS is processed and bundled **server-side** by Scorpion at build time
- The browser receives fully compiled stylesheet bundles — original source file structure is not visible
- Different pages may load different bundles depending on which components they include
- Google Fonts are referenced via `@import` within compiled stylesheets — no separate font extraction needed

### Interactive JS
- Scorpion supplies the JavaScript for all interactive utilities (sliders, accordions, tabs, etc.)
- This JS is extracted from the live site and bundled directly into the WordPress child theme
- No plugin detection or plugin mapping is required

---

## 3. The `/wp-converter/` Endpoint

Every Scorpion site exposes a dedicated page at `{site_url}/wp-converter/` that the tool requests at the start of every conversion job. This is the authoritative source for site structure and content zone data.

### Data provided

**`#SiteMapListTable`** — full page inventory

| Column | Description |
|---|---|
| `Path` | Root-relative page path e.g. `/about` |
| `PageName` | Human-readable page title |
| `Meta Title` | SEO meta title for the page |
| `Meta Description` | SEO meta description for the page |

Canonical URL is not a separate column — it is constructed by the tool as `site_url + Path`.

**`#SiteContentIdsTable`** — verified editable content zone IDs

| Column | Description |
|---|---|
| `ElementID` | HTML element ID that is a verified editable content zone in the Scorpion CMS |

Content zone IDs are **site-specific** — they vary from site to site and are authoritative for that site only.

### HTML table structure
```html
<table id="SiteMapListTable">
  <tr>
    <td>Path</td>
    <td>PageName</td>
    <td>Meta Title</td>
    <td>Meta Description</td>
  </tr>
  <tr>
    <td>{Path}</td>
    <td>{PageName}</td>
    <td>{MetaTitle}</td>
    <td>{MetaDescription}</td>
  </tr>
</table>

<table id="SiteContentIdsTable">
  <tr>
    <td>ElementID</td>
  </tr>
  <tr>
    <td>{ElementID}</td>
  </tr>
</table>
```

### User-entered values (at job start)
- **Site title** — used in the WordPress theme and WXR metadata
- **USC version** — selected from a constrained dropdown: **USC 3.0**, **USC 4.0**, or **USC 4.2**. Stored in the job record for logging/metadata purposes. The tool does not attempt to detect the USC version from the live site — it is not reliably distinguishable from rendered page markup. Sites running pre-USC 3.0 frameworks are not supported.

---

## 4. Conversion Strategy

### 4.1 `/wp-converter/` ingestion
Before any crawling begins:
1. Request `{site_url}/wp-converter/`
2. Parse `#SiteMapListTable` → build full page list with SEO metadata
3. Parse `#SiteContentIdsTable` → build content zone ID lookup set
4. Construct canonical URLs as `site_url + Path`

### 4.2 Stylesheet extraction
1. Crawl every page URL from `#SiteMapListTable`
2. Collect all unique stylesheet URLs found in each page `<head>`
3. Download each stylesheet as-is — no modification
4. Enqueue all discovered stylesheets **globally** in the WordPress child theme via `functions.php`

No conditional enqueuing. All stylesheets load on all pages. Intentional tradeoff — simpler implementation, reliable accuracy.

Google Fonts travel via `@import` inside compiled stylesheets and require no additional handling.

### 4.3 JavaScript extraction
1. Collect all unique Scorpion JS file URLs across all crawled pages
2. Download each as-is — no modification
3. Bundle into the WordPress child theme, enqueued in footer via `functions.php`

Exclude third-party JS (analytics, chat widgets, etc.) — include only JS files hosted on the Scorpion domain.

### 4.4 Content zone extraction
For each crawled page:
1. Load rendered HTML into Cheerio
2. Find all elements whose `id` attribute exists in the content zone ID lookup set
3. Extract inner HTML of each matched element
4. Replace the element in the page template with a Classic block placeholder: `<!-- WP_CLASSIC_BLOCK_{index} -->`
5. Register each as a Gutenberg Classic block in the WordPress page content

**Rules:**
- Content zone IDs from `#SiteContentIdsTable` are the **sole signal** for editable content — no class-based detection
- Extract inner HTML only — do not include the wrapper element itself
- Preserve inner HTML exactly as-is — no tag stripping, attribute modification, or whitespace cleanup
- Every page gets its own generated WordPress template — no template sharing or override logic

### 4.5 Navigation extraction
Navigation is handled entirely by the crawler since it can vary from page to page.

```
For each crawled page:
  1. Find the primary <nav> element
  2. Extract all <a> elements — href and text content
  3. Infer hierarchy from ul > li nesting
  4. Store nav structure keyed to that page URL

After all pages crawled:
  1. Compare nav structures across all pages
  2. If all identical → register one WordPress menu globally
  3. If variations detected → flag in the review wizard
     for user to select which nav becomes the WordPress primary menu
```

### 4.6 Media assets
1. Find all media URLs across crawled pages (img src, srcset, picture source, inline background-image)
2. Download to local temp directory: `/tmp/scorpion-conversions/{job_id}/media/`
3. Re-reference all URLs in page templates and Classic block content to point to WordPress uploads path
4. Bundle into export `.zip`
5. Temp directory auto-deleted after export is delivered

No external storage service. Local temp is sufficient — media is only needed transiently during conversion.

### 4.7 Assets migrated
- Page HTML structure (as static WordPress page templates — one per page)
- Content zone inner HTML (as Gutenberg Classic blocks)
- All discovered stylesheets (enqueued globally)
- Interactive component JavaScript (bundled into theme, enqueued in footer)
- Images and media (local temp → export zip)
- SEO metadata (from `/wp-converter/` — titles, descriptions, canonical URLs)
- Navigation menus (from crawler)
- Forms
- Blog posts

---

## 5. User Experience

### 5.1 Target users
- **Technical** — Scorpion developers/engineers: want visibility, raw diffs, direct WP install option
- **Non-technical** — account managers or clients: guided visual experience, no jargon

### 5.2 User-entered values at job start
Before crawling begins the user provides:
- Scorpion site URL
- Site title
- USC version — dropdown: **USC 3.0**, **USC 4.0**, or **USC 4.2** (pre-USC 3.0 not supported)

### 5.3 Conversion flow

#### Step 1 — Enter site details
User enters site URL, site title, and USC version. Tool immediately requests `/wp-converter/` and displays a confirmation summary: pages found, content zones identified.

#### Step 2 — Crawl
Tool crawls every page URL from the sitemap. Live progress shown via WebSocket. Collects stylesheets, JS, media, content zones, and navigation per page.

#### Step 3 — Review wizard
User reviews each asset category:
- **Pages** — full page list, confirm which to include
- **Navigation** — if variations detected across pages, user selects the primary menu
- **Content zones** — list of detected zones and which pages they appear on
- **Media** — asset inventory, flag any broken items
- **Forms** — detected forms and field structures
- **Stylesheets** — list of extracted bundles

#### Step 4 — Preview
Side-by-side: original Scorpion page vs WordPress output approximation.
- Non-technical: visual comparison
- Technical: toggle to raw HTML diff

#### Step 5 — Export
Download `.zip` containing:
- WordPress child theme (stylesheets, JS, page templates)
- Gutenberg Classic block content for all content zones
- Media asset folder
- WXR XML file (pages, posts, menus, SEO metadata)
- Migration checklist

Optional for technical users: direct push to WordPress install via WP REST API.

---

## 6. Out of Scope (v1)

| Item | Reason deferred |
|---|---|
| Legacy framework support | Non-USC frameworks — detect and reject cleanly. Different extraction logic needed. |
| Pre-USC 3.0 framework sites | USC variants older than 3.0 differ structurally from 3.0+. The version dropdown floor is USC 3.0. |
| USC/Make/Model selection UI | Not needed with fully dynamic extraction |
| Admin config system | No framework library to maintain |
| Pre-built WordPress theme library | Replaced by dynamic extraction |
| WordPress plugin mapping for JS utilities | Scorpion supplies JS directly |
| Conditional stylesheet enqueuing | Performance optimisation — deferred |
| CSS refactoring / ID-to-class conversion | Stylesheets carried over as-is |
| Computed style extraction | Authored stylesheets sufficient |
| Page template override logic | Every page gets its own template — simpler and accurate |
| Class-based content zone detection (`.cnt-stl`) | Replaced by verified ID list from `/wp-converter/` |

---

## 7. Open Questions

| Question | Context |
|---|---|
| Will the tool require user authentication? | Internal only vs. client-facing affects auth architecture significantly |
| What WordPress hosting environment are converted sites landing on? | Affects WP REST API direct-push feasibility |
| Are there edge cases where content zone inner HTML contains structural non-editable HTML? | Would affect whether Classic block injection needs sanitisation |
| How should the tool handle sites with hundreds of pages? | May require paginated crawl and chunked export packaging |
| Can `/wp-converter/` ever be unavailable or return incomplete data? | Need a defined failure behaviour for the job |
