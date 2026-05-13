import * as cheerio from "cheerio";
import { IngestParseError } from "./errors";
import type { ScorpionPage } from "./types";

export interface ParsedTables {
  pages: ScorpionPage[];
  contentZoneIds: Set<string>;
  iconMap: Map<string, string>;
}

export function parseWpConverter(
  html: string,
  siteUrl: string,
): ParsedTables {
  const $ = cheerio.load(html);
  const pages = parseSiteMapTable($, siteUrl);
  const contentZoneIds = parseContentIdsTable($, siteUrl);
  const iconMap = parseSiteIconTable($);
  return { pages, contentZoneIds, iconMap };
}

function parseSiteMapTable(
  $: cheerio.CheerioAPI,
  siteUrl: string,
): ScorpionPage[] {
  const table = $("#SiteMapListTable");
  if (table.length === 0) {
    throw new IngestParseError(
      siteUrl,
      "#SiteMapListTable not found in /wp-converter/ response",
    );
  }

  const pages: ScorpionPage[] = [];
  table.find("tr").each((index, tr) => {
    if (index === 0) return;
    const cells = $(tr).find("td");
    if (cells.length < 4) return;

    const path = cells.eq(0).text().trim();
    if (!path) return;
    if (isWpConverterPath(path)) return;

    pages.push({
      path,
      title: cells.eq(1).text().trim(),
      metaTitle: cells.eq(2).text().trim(),
      metaDescription: cells.eq(3).text().trim(),
      canonical: new URL(path, siteUrl).toString(),
    });
  });

  return pages;
}

// Per EXTRACTION.md Step 1: the /wp-converter/ endpoint must not be
// crawled as a site page even though it appears in #SiteMapListTable.
function isWpConverterPath(path: string): boolean {
  return path.replace(/\/$/, "").toLowerCase() === "/wp-converter";
}

function parseContentIdsTable(
  $: cheerio.CheerioAPI,
  siteUrl: string,
): Set<string> {
  const table = $("#SiteContentIdsTable");
  if (table.length === 0) {
    throw new IngestParseError(
      siteUrl,
      "#SiteContentIdsTable not found in /wp-converter/ response",
    );
  }

  const ids = new Set<string>();
  table.find("tr").each((index, tr) => {
    if (index === 0) return;
    const cells = $(tr).find("td");
    if (cells.length < 1) return;

    const id = cells.eq(0).text().trim();
    if (id) ids.add(id);
  });

  return ids;
}

// #SiteIconTable holds inline SVG icons keyed by name. Cells are
// (IconID, IconName, Size, Path), and Path contains the literal
// `<svg><path d="…"/></svg>` markup. We store the inner contents of
// each cell's <svg> — the templates' parent <svg viewBox="…"> element
// will keep its own attributes; substitution only replaces the inner
// `<use data-href="…#name">` element with the looked-up paths.
//
// The table is optional: older /wp-converter/ versions don't include it.
// In that case the build pipeline runs without icon substitution and
// the `<use data-href>` references survive into the output (where they
// don't render unless Scorpion's lazy-load JS is also loaded).
function parseSiteIconTable($: cheerio.CheerioAPI): Map<string, string> {
  const table = $("#SiteIconTable");
  if (table.length === 0) return new Map();

  const map = new Map<string, string>();
  table.find("tr").each((index, tr) => {
    if (index === 0) return;
    const cells = $(tr).find("td");
    if (cells.length < 4) return;

    const iconName = cells.eq(1).text().trim();
    if (!iconName) return;
    const $svg = cells.eq(3).find("svg").first();
    if ($svg.length === 0) return;
    const inner = $svg.html();
    if (inner && inner.trim().length > 0) {
      map.set(iconName, inner);
    }
  });
  return map;
}
