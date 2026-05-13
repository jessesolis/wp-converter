import * as cheerio from "cheerio";
import type { CrawlResult } from "../crawl";
import type { ExtractedZone, PageContentZones } from "./types";

const PLACEHOLDER_PREFIX = "WP_CLASSIC_BLOCK_";

export function extractContentZones(
  fullHtml: string,
  contentZoneIds: Set<string>,
  pageUrl: string,
  path: string,
): PageContentZones {
  const $ = cheerio.load(fullHtml);
  const zones: ExtractedZone[] = [];
  let index = 0;

  $("[id]").each((_, el) => {
    const $el = $(el);
    const id = $el.attr("id");
    if (!id || !contentZoneIds.has(id)) return;

    const innerHtml = $el.html() ?? "";
    zones.push({ zoneId: id, index, innerHtml });
    $el.replaceWith(`<!-- ${PLACEHOLDER_PREFIX}${index} -->`);
    index++;
  });

  return {
    pageUrl,
    path,
    zones,
    template: $.html(),
  };
}

export function extractAllContentZones(
  crawl: CrawlResult,
  contentZoneIds: Set<string>,
): PageContentZones[] {
  const out: PageContentZones[] = [];
  for (const page of crawl.pages) {
    if (page.status !== "ok" || !page.fullHtml) continue;
    out.push(
      extractContentZones(
        page.fullHtml,
        contentZoneIds,
        page.pageUrl,
        page.path,
      ),
    );
  }
  return out;
}

