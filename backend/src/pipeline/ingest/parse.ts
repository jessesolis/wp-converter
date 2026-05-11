import * as cheerio from "cheerio";
import { IngestParseError } from "./errors";
import type { ScorpionPage } from "./types";

export interface ParsedTables {
  pages: ScorpionPage[];
  contentZoneIds: Set<string>;
}

export function parseWpConverter(
  html: string,
  siteUrl: string,
): ParsedTables {
  const $ = cheerio.load(html);
  const pages = parseSiteMapTable($, siteUrl);
  const contentZoneIds = parseContentIdsTable($, siteUrl);
  return { pages, contentZoneIds };
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
