import type { CrawlResult } from "../crawl";

export interface AssetInventory {
  siteUrl: string;
  siteHostname: string;
  // Global dedup'd URL lists — used to drive downloads (so a file shared by
  // multiple pages is fetched once).
  stylesheets: string[];
  scripts: string[];
  // Global dedup'd inline <style> block contents. The index of each entry is
  // the key used in pageInlineStyleIndices.
  inlineStyles: string[];
  excludedStylesheets: string[];
  excludedScripts: string[];
  // Per-page URL lists in original document load order. Same-host filtering
  // matches the global lists; cross-host URLs are dropped here too. URLs may
  // appear in multiple pages — the per-page lists drive WordPress
  // conditional enqueue at request time.
  pageStylesheets: Map<string, string[]>;
  pageScripts: Map<string, string[]>;
  // Per-page indices into `inlineStyles` (above), preserving order.
  pageInlineStyleIndices: Map<string, number[]>;
}

export function collectAssets(crawl: CrawlResult): AssetInventory {
  const siteHostname = new URL(crawl.siteUrl).hostname;

  const stylesheets = new Set<string>();
  const scripts = new Set<string>();
  const excludedStylesheets = new Set<string>();
  const excludedScripts = new Set<string>();

  // Inline styles are deduped by content via this index map so identical
  // blocks emitted on multiple pages reuse the same global entry.
  const inlineStyles: string[] = [];
  const inlineStyleIndexByContent = new Map<string, number>();

  const pageStylesheets = new Map<string, string[]>();
  const pageScripts = new Map<string, string[]>();
  const pageInlineStyleIndices = new Map<string, number[]>();

  for (const page of crawl.pages) {
    if (page.status !== "ok") continue;

    const perPageCss: string[] = [];
    for (const url of page.stylesheetUrls ?? []) {
      if (isSameHostname(url, siteHostname)) {
        stylesheets.add(url);
        if (!perPageCss.includes(url)) perPageCss.push(url);
      } else {
        excludedStylesheets.add(url);
      }
    }
    pageStylesheets.set(page.path, perPageCss);

    const perPageJs: string[] = [];
    for (const url of page.scriptUrls ?? []) {
      if (isSameHostname(url, siteHostname)) {
        scripts.add(url);
        if (!perPageJs.includes(url)) perPageJs.push(url);
      } else {
        excludedScripts.add(url);
      }
    }
    pageScripts.set(page.path, perPageJs);

    const perPageInlineIdx: number[] = [];
    for (const style of page.inlineStyles ?? []) {
      let idx = inlineStyleIndexByContent.get(style);
      if (idx === undefined) {
        idx = inlineStyles.length;
        inlineStyles.push(style);
        inlineStyleIndexByContent.set(style, idx);
      }
      if (!perPageInlineIdx.includes(idx)) perPageInlineIdx.push(idx);
    }
    pageInlineStyleIndices.set(page.path, perPageInlineIdx);
  }

  return {
    siteUrl: crawl.siteUrl,
    siteHostname,
    stylesheets: [...stylesheets],
    scripts: [...scripts],
    inlineStyles,
    excludedStylesheets: [...excludedStylesheets],
    excludedScripts: [...excludedScripts],
    pageStylesheets,
    pageScripts,
    pageInlineStyleIndices,
  };
}

function isSameHostname(url: string, expectedHostname: string): boolean {
  try {
    return new URL(url).hostname === expectedHostname;
  } catch {
    return false;
  }
}
