import puppeteer from "puppeteer";
import type { IngestResult } from "../ingest";
import { crawlPage, DEFAULT_PAGE_TIMEOUT_MS } from "./crawl-page";
import type { CrawlOptions, CrawlResult, CrawledPage } from "./types";

const DEFAULT_CONCURRENCY = 4;

export async function crawlSite(
  ingest: IngestResult,
  options: CrawlOptions = {},
): Promise<CrawlResult> {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const timeoutMs = options.perPageTimeoutMs ?? DEFAULT_PAGE_TIMEOUT_MS;
  const startedAt = new Date();

  if (ingest.pages.length === 0) {
    return {
      siteUrl: ingest.siteUrl,
      pages: [],
      startedAt,
      finishedAt: new Date(),
    };
  }

  const browser = await puppeteer.launch({ headless: true });
  try {
    const indexed = ingest.pages.map((page, index) => ({ page, index }));
    const results: CrawledPage[] = new Array(ingest.pages.length);
    let next = 0;

    async function worker(): Promise<void> {
      while (true) {
        const cursor = next++;
        if (cursor >= indexed.length) return;
        const { page, index } = indexed[cursor];
        results[index] = await crawlPage(
          browser,
          page.canonical,
          page.path,
          timeoutMs,
        );
      }
    }

    const workerCount = Math.min(concurrency, indexed.length);
    await Promise.all(
      Array.from({ length: workerCount }, () => worker()),
    );

    return {
      siteUrl: ingest.siteUrl,
      pages: results,
      startedAt,
      finishedAt: new Date(),
    };
  } finally {
    await browser.close();
  }
}

export type {
  CrawledPage,
  CrawlResult,
  CrawlOptions,
  CrawlPageStatus,
} from "./types";
