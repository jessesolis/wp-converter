export type CrawlPageStatus =
  | "ok"
  | "timeout"
  | "non_200"
  | "navigation_error";

export interface CrawledPage {
  pageUrl: string;
  path: string;
  status: CrawlPageStatus;
  httpStatus?: number;
  error?: string;
  durationMs: number;
  fullHtml?: string;
  stylesheetUrls?: string[];
  scriptUrls?: string[];
  imageUrls?: string[];
  inlineStyles?: string[];
  navHtml?: string | null;
}

export interface CrawlResult {
  siteUrl: string;
  pages: CrawledPage[];
  startedAt: Date;
  finishedAt: Date;
}

export interface CrawlOptions {
  concurrency?: number;
  perPageTimeoutMs?: number;
}
