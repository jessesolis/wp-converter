# Scorpion CMS → WordPress Conversion Tool

## What this project is
A web app that converts live Scorpion CMS sites into fully functional, visually accurate WordPress sites. It serves both technical and non-technical Scorpion users.

## Critical design principles
- **Visual accuracy is the #1 priority** — clients will not accept visible differences between the Scorpion site and the converted WordPress site
- **Fully dynamic extraction** — everything is extracted from the live rendered site. No pre-built theme library. No template mapping. No framework config system.
- **One WordPress template per page** — every page gets its own template regardless of whether pages share a Scorpion template. Simpler, predictable, accurate.
- **Ease of implementation over perfection** — deliberate tradeoffs have been made in favour of simpler implementation (e.g. all stylesheets enqueued globally rather than conditionally)
- **Minimal ongoing maintenance** — the tool must not require Scorpion team maintenance as new models/makes are released

## Data sources
| Data | Source |
|---|---|
| Page URLs, titles, SEO metadata | Scraped from `{site_url}/wp-converter/` — `#SiteMapListTable` |
| Content zone IDs | Scraped from `{site_url}/wp-converter/` — `#SiteContentIdsTable` |
| Canonical URL | Constructed: `site_url` + page `Path` |
| Site title | User entered at job start |
| USC version | User entered at job start (informational only) |
| Stylesheets, JS, media, navigation | Crawler |

## Scope boundary
- ✅ Active USC-based Scorpion sites only
- ❌ Legacy (non-USC) frameworks — detect and surface an unsupported message, do not attempt conversion
- ❌ Plugin mapping for interactive components — Scorpion supplies the JS directly
- ❌ Pre-built WordPress theme library
- ❌ USC/Make/Model admin config system
- ❌ Page template overrides — every page gets its own generated template

## Docs to read
- `SPEC.md` — full product specification
- `ARCHITECTURE.md` — system architecture and data flow
- `EXTRACTION.md` — crawler and DOM extraction rules (read before any crawler/parser work)
- `WORDPRESS-OUTPUT.md` — WordPress output structure and conventions (read before any WP output work)
- `DECISIONS.md` — log of key decisions made during planning and why

---
> Always read ARCHITECTURE.md before writing any pipeline or backend code.
> Always read EXTRACTION.md before touching anything related to the crawler or DOM parser.
> Always read WORDPRESS-OUTPUT.md before generating any WordPress output files.
