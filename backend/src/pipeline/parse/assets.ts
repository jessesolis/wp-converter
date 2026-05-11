import type { CrawlResult } from "../crawl";

export interface AssetInventory {
  siteUrl: string;
  siteHostname: string;
  stylesheets: string[];
  scripts: string[];
  inlineStyles: string[];
  excludedStylesheets: string[];
  excludedScripts: string[];
}

export function collectAssets(crawl: CrawlResult): AssetInventory {
  const siteHostname = new URL(crawl.siteUrl).hostname;

  const stylesheets = new Set<string>();
  const scripts = new Set<string>();
  const inlineStyles = new Set<string>();
  const excludedStylesheets = new Set<string>();
  const excludedScripts = new Set<string>();

  for (const page of crawl.pages) {
    if (page.status !== "ok") continue;

    for (const url of page.stylesheetUrls ?? []) {
      (isSameHostname(url, siteHostname) ? stylesheets : excludedStylesheets).add(url);
    }
    for (const url of page.scriptUrls ?? []) {
      (isSameHostname(url, siteHostname) ? scripts : excludedScripts).add(url);
    }
    for (const style of page.inlineStyles ?? []) {
      inlineStyles.add(style);
    }
  }

  return {
    siteUrl: crawl.siteUrl,
    siteHostname,
    stylesheets: [...stylesheets],
    scripts: [...scripts],
    inlineStyles: [...inlineStyles],
    excludedStylesheets: [...excludedStylesheets],
    excludedScripts: [...excludedScripts],
  };
}

function isSameHostname(url: string, expectedHostname: string): boolean {
  try {
    return new URL(url).hostname === expectedHostname;
  } catch {
    return false;
  }
}
