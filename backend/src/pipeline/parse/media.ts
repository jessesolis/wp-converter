import * as cheerio from "cheerio";
import type { CrawlResult } from "../crawl";

const DOWNLOADABLE_EXTS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".zip",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
]);

export interface MediaInventory {
  siteUrl: string;
  siteHostname: string;
  images: string[];
  downloadables: string[];
  backgrounds: string[];
  excludedImages: string[];
  excludedDownloadables: string[];
  excludedBackgrounds: string[];
}

export function collectMedia(crawl: CrawlResult): MediaInventory {
  const siteHostname = new URL(crawl.siteUrl).hostname;
  const images = new Set<string>();
  const downloadables = new Set<string>();
  const backgrounds = new Set<string>();
  const excludedImages = new Set<string>();
  const excludedDownloadables = new Set<string>();
  const excludedBackgrounds = new Set<string>();

  for (const page of crawl.pages) {
    if (page.status !== "ok" || !page.fullHtml) continue;
    const $ = cheerio.load(page.fullHtml);

    // Scorpion's lazy-load swaps `data-src`/`data-srcset` into `src`/`srcset`
    // at runtime; the static markup carries the real URL in the data-* attrs
    // and a 1x1 placeholder in src. Walk both pairs.
    const collectImgLikeAttrs = (el: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const $el = $(el as any);
      for (const attr of ["src", "data-src"] as const) {
        bucketize(
          toAbsolute($el.attr(attr), page.pageUrl),
          images,
          excludedImages,
          siteHostname,
        );
      }
      for (const attr of ["srcset", "data-srcset"] as const) {
        const srcset = $el.attr(attr);
        if (!srcset) continue;
        for (const u of parseSrcset(srcset)) {
          bucketize(
            toAbsolute(u, page.pageUrl),
            images,
            excludedImages,
            siteHostname,
          );
        }
      }
    };

    $("img").each((_, el) => collectImgLikeAttrs(el));
    $("source").each((_, el) => collectImgLikeAttrs(el));

    $("a[href]").each((_, el) => {
      const abs = toAbsolute($(el).attr("href"), page.pageUrl);
      if (abs && isDownloadableUrl(abs)) {
        bucketize(abs, downloadables, excludedDownloadables, siteHostname);
      }
    });

    $("[style*='url(']").each((_, el) => {
      const style = $(el).attr("style") ?? "";
      for (const u of parseBackgroundUrls(style)) {
        bucketize(
          toAbsolute(u, page.pageUrl),
          backgrounds,
          excludedBackgrounds,
          siteHostname,
        );
      }
    });
  }

  return {
    siteUrl: crawl.siteUrl,
    siteHostname,
    images: [...images],
    downloadables: [...downloadables],
    backgrounds: [...backgrounds],
    excludedImages: [...excludedImages],
    excludedDownloadables: [...excludedDownloadables],
    excludedBackgrounds: [...excludedBackgrounds],
  };
}

function bucketize(
  url: string | null,
  same: Set<string>,
  excluded: Set<string>,
  hostname: string,
): void {
  if (!url) return;
  if (looksLikeBase64Leakage(url)) return;
  try {
    const u = new URL(url);
    (u.hostname === hostname ? same : excluded).add(url);
  } catch {
    // skip malformed
  }
}

// Lazy-load libraries store a 1x1 transparent GIF placeholder data URI in
// src/srcset. When that data URI contains commas (which they do), naive
// srcset parsing can yield the post-comma base64 fragment as if it were a
// relative URL. Resolved against the page URL it produces garbage like
// https://site.com/R0lGODlh… — catch and drop those here as a safety net.
function looksLikeBase64Leakage(url: string): boolean {
  try {
    const trimmed = new URL(url).pathname.replace(/^\/+/, "");
    if (trimmed.length < 20) return false;
    if (trimmed.includes("/") || trimmed.includes(".")) return false;
    return /^[A-Za-z0-9+/=]+$/.test(trimmed);
  } catch {
    return false;
  }
}

function toAbsolute(href: string | undefined, pageUrl: string): string | null {
  if (!href) return null;
  if (href.startsWith("data:") || href.startsWith("#") || href.startsWith("javascript:")) {
    return null;
  }
  try {
    return new URL(href, pageUrl).toString();
  } catch {
    return null;
  }
}

function parseSrcset(srcset: string): string[] {
  // data: URIs contain commas and break naive comma-split parsing.
  // Lazy-load placeholders use them; real srcsets don't reference them,
  // so we can safely skip any srcset that contains one.
  if (srcset.includes("data:")) return [];
  return srcset
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0])
    .filter((u) => u.length > 0);
}

function isDownloadableUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    for (const ext of DOWNLOADABLE_EXTS) {
      if (path.endsWith(ext)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function parseBackgroundUrls(style: string): string[] {
  const urls: string[] = [];
  const re = /url\(\s*(?:'([^']*)'|"([^"]*)"|([^)]+?))\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(style)) !== null) {
    const url = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (url) urls.push(url);
  }
  return urls;
}
