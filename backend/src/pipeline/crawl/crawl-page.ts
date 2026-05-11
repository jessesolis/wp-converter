/// <reference lib="dom" />
import { TimeoutError, type Browser } from "puppeteer";
import type { CrawledPage } from "./types";

export const DEFAULT_PAGE_TIMEOUT_MS = 30_000;

interface InPageExtraction {
  stylesheetUrls: string[];
  scriptUrls: string[];
  imageUrls: string[];
  inlineStyles: string[];
  navHtml: string | null;
}

export async function crawlPage(
  browser: Browser,
  pageUrl: string,
  path: string,
  timeoutMs: number = DEFAULT_PAGE_TIMEOUT_MS,
): Promise<CrawledPage> {
  const start = Date.now();
  const page = await browser.newPage();
  try {
    const response = await page.goto(pageUrl, {
      waitUntil: "networkidle2",
      timeout: timeoutMs,
    });

    if (!response) {
      return {
        pageUrl,
        path,
        status: "navigation_error",
        error: "No response from navigation",
        durationMs: Date.now() - start,
      };
    }

    const httpStatus = response.status();
    if (httpStatus < 200 || httpStatus >= 300) {
      return {
        pageUrl,
        path,
        status: "non_200",
        httpStatus,
        durationMs: Date.now() - start,
      };
    }

    const fullHtml = await page.content();
    const extracted = await page.evaluate(extractInPage);

    return {
      pageUrl,
      path,
      status: "ok",
      httpStatus,
      durationMs: Date.now() - start,
      fullHtml,
      stylesheetUrls: extracted.stylesheetUrls,
      scriptUrls: extracted.scriptUrls,
      imageUrls: extracted.imageUrls,
      inlineStyles: extracted.inlineStyles,
      navHtml: extracted.navHtml,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      pageUrl,
      path,
      status: err instanceof TimeoutError ? "timeout" : "navigation_error",
      error: message,
      durationMs: Date.now() - start,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

// Runs inside the browser page context — must be self-contained.
// `document`, `HTMLLinkElement`, etc. resolve in the browser, not in Node.
function extractInPage(): InPageExtraction {
  // Match <link rel="stylesheet"> anywhere in the document — Scorpion's
  // main CSS bundle is rendered into <body>, not <head>.
  const stylesheetUrls = Array.from(
    document.querySelectorAll('link[rel="stylesheet"][href]'),
  ).map((el) => (el as HTMLLinkElement).href);

  const scriptUrls = Array.from(
    document.querySelectorAll("script[src]"),
  ).map((el) => (el as HTMLScriptElement).src);

  const inlineStyles: string[] = [];
  document.querySelectorAll("style").forEach((style) => {
    const content = style.textContent ?? "";
    if (content.length > 0) inlineStyles.push(content);
  });

  const imageUrls: string[] = [];
  document.querySelectorAll("img").forEach((img) => {
    if (img.src) imageUrls.push(img.src);
    if (img.srcset) {
      img.srcset.split(",").forEach((part) => {
        const url = part.trim().split(/\s+/)[0];
        if (url) imageUrls.push(url);
      });
    }
  });

  const navs = Array.from(document.querySelectorAll("nav"));
  let primaryNav: Element | null = null;
  let maxLinks = -1;
  for (const nav of navs) {
    const count = nav.querySelectorAll("a").length;
    if (count > maxLinks) {
      maxLinks = count;
      primaryNav = nav;
    }
  }

  return {
    stylesheetUrls,
    scriptUrls,
    imageUrls,
    inlineStyles,
    navHtml: primaryNav ? primaryNav.innerHTML : null,
  };
}
