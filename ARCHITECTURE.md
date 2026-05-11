# ARCHITECTURE.md — System Architecture

---

## Stack Overview

### Frontend
| Technology | Purpose |
|---|---|
| Next.js (React) | Application framework — wizard UI, step routing, preview panes |
| Tailwind CSS | Utility-first styling |
| Shadcn/ui | Component library — modals, steppers, progress bars |

### Backend
| Technology | Purpose |
|---|---|
| Node.js + Express | API layer — orchestrates the conversion pipeline |
| Puppeteer | Headless browser — crawls every page URL, captures fully rendered output |
| Cheerio | DOM parsing — ingests `/wp-converter/` tables, extracts content zones, nav, forms, media |
| Sharp | Image optimisation and format normalisation during media download |

### WordPress Output
| Technology | Purpose |
|---|---|
| WXR XML builder | Standard WordPress import format — pages, posts, menus, SEO metadata |
| WordPress child theme scaffold | Receives extracted stylesheets and JS, enqueues globally via `functions.php` |
| Gutenberg Classic blocks | Wraps extracted content zone inner HTML into editable WP blocks |
| WP REST API (optional) | Direct push to a WordPress install for technical users |

### Infrastructure
| Technology | Purpose |
|---|---|
| PostgreSQL | Conversion jobs, user sessions, crawl results, audit logs |
| Redis + BullMQ | Job queue for long-running crawl and build tasks with WebSocket progress |
| Local temp storage | `/tmp/scorpion-conversions/{job_id}/` — auto-deleted after export delivery |

---

## Data Sources

| Data | Source | Method |
|---|---|---|
| Page URLs | `{site_url}/wp-converter/` `#SiteMapListTable` | Cheerio parse |
| Page titles | `{site_url}/wp-converter/` `#SiteMapListTable` | Cheerio parse |
| SEO meta title + description | `{site_url}/wp-converter/` `#SiteMapListTable` | Cheerio parse |
| Content zone IDs | `{site_url}/wp-converter/` `#SiteContentIdsTable` | Cheerio parse |
| Canonical URLs | Constructed: `site_url + path` | — |
| Site title | User entered at job start | — |
| USC version | User-selected at job start from a constrained dropdown: USC 3.0, USC 4.0, or USC 4.2 | — |
| Stylesheets | Crawled from every page `<head>` | Puppeteer + Cheerio |
| JS utilities | Crawled from every page | Puppeteer + Cheerio |
| Navigation | Crawled from every page `<nav>` | Puppeteer + Cheerio |
| Media assets | Crawled from every page | Puppeteer + Cheerio |
| Forms | Crawled from every page | Puppeteer + Cheerio |

---

## System Data Flow

```
User enters: site URL, site title, USC version
                    │
                    ▼
        Legacy framework detection
        (lightweight HTTP GET + fingerprint)
                    │
          ┌─────────┴──────────┐
     Unsupported            USC site
          │                    │
    Reject + message           ▼
                   GET {site_url}/wp-converter/
                   Parse #SiteMapListTable
                   Parse #SiteContentIdsTable
                   Build: page list, content zone ID set
                    │
                    ▼
        ┌───────────────────────────┐
        │      Puppeteer Crawler    │  ← BullMQ job
        │  Visits every page URL   │
        │  from #SiteMapListTable  │
        │                          │
        │  Per page captures:      │
        │  - Rendered HTML         │
        │  - Stylesheet URLs       │
        │  - JS file URLs          │
        │  - <nav> structure       │
        │  - Media URLs            │
        │  - <form> elements       │
        └────────────┬─────────────┘
                     │
                     ▼
        ┌───────────────────────────┐
        │     Cheerio DOM Parser    │
        │                          │
        │  - Deduplicate stylesheets│
        │  - Deduplicate JS files  │
        │  - Extract content zones │
        │    (ID set cross-ref)    │
        │  - Compare nav per page  │
        │  - Deduplicate media     │
        │  - Extract forms         │
        └────────────┬─────────────┘
                     │
                     ▼
        ┌───────────────────────────┐
        │     Asset Downloads       │
        │                          │
        │  - Download stylesheets  │
        │    → /tmp/.../stylesheets/│
        │  - Download JS files     │
        │    → /tmp/.../js/        │
        │  - Download media        │
        │    → /tmp/.../media/     │
        │  - Rewrite media URLs    │
        │    in templates + blocks │
        └────────────┬─────────────┘
                     │
                     ▼
        ┌───────────────────────────┐
        │   WordPress Package       │
        │   Builder                 │
        │                          │
        │  - Build child theme     │
        │    (functions.php,       │
        │     style.css,           │
        │     page templates)      │
        │  - Inject Classic blocks │
        │  - Build WXR XML         │
        │  - Write migration       │
        │    checklist             │
        │  - Zip everything        │
        └────────────┬─────────────┘
                     │
                     ▼
            User downloads .zip
       (or optional WP REST API push)
                     │
                     ▼
        Auto-delete /tmp/{job_id}/
```

---

## Job Queue Architecture

Long-running conversions are managed as background jobs via BullMQ.

### Job stages (in order)
```
1. framework_check    Lightweight fingerprint — USC or unsupported
2. ingest             GET /wp-converter/, parse both tables
3. crawl              Puppeteer visits all pages
4. parse              Cheerio extracts all assets and content zones
5. download           Stylesheets, JS, media downloaded to temp
6. build              WordPress package assembled
7. ready              Export .zip available for download
```

Each stage emits progress via WebSocket to the frontend.

### Job record (PostgreSQL)
```sql
jobs
  id            uuid PRIMARY KEY
  status        enum('queued','framework_check','ingest','crawl','parse','download','build','ready','failed')
  site_url      text NOT NULL
  site_title    text
  usc_version   text          -- one of: 'USC 3.0', 'USC 4.0', 'USC 4.2' (see backend/src/config/usc-versions.ts)
  created_at    timestamp DEFAULT now()
  completed_at  timestamp
  error         text          -- null unless failed
  output_path   text          -- local path to export.zip, null until ready
```

### Retry policy
- Failed stages retry up to **3 times** with exponential backoff
- After 3 failures the job status is set to `failed` and the user is notified
- Completed job temp directories are deleted immediately after export delivery
- Abandoned jobs (no download after **24 hours**) are cleaned up by a scheduled task

---

## Navigation Conflict Resolution

Since navigation can vary per page, the tool must detect and surface variations:

```
After crawl:
  - If all pages have identical nav structure → auto-select, no user input needed
  - If variations exist → present unique nav variants in the review wizard
    → user selects which becomes the WordPress primary menu
    → selected nav is registered in WXR as the primary menu
```

---

## Frontend Route Structure

```
/                        Landing — enter site URL, title, USC version
/job/[id]                Live crawl progress (WebSocket feed)
/job/[id]/review         Wizard — step-by-step asset review
/job/[id]/review/pages   Page list review
/job/[id]/review/nav     Navigation review (shown only if variations detected)
/job/[id]/review/zones   Content zone review
/job/[id]/review/media   Media inventory review
/job/[id]/review/forms   Form review
/job/[id]/review/styles  Stylesheet list review
/job/[id]/preview        Side-by-side preview
/job/[id]/export         Download .zip / WP REST push
```
