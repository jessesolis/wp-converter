import { mkdir, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { MediaInventory } from "../parse";

export const WP_UPLOAD_PREFIX = "/wp-content/uploads/scorpion-migration";

const DEFAULT_CONCURRENCY = 8;
const DEFAULT_TIMEOUT_MS = 30_000;
const USER_AGENT =
  "ScorpionWPConverter/0.1 (+https://scorpion.co; conversion-tool)";

export type DownloadStatus = "ok" | "failed";

export interface DownloadResult {
  url: string;
  status: DownloadStatus;
  filename?: string;
  wpPath?: string;
  byteSize?: number;
  contentType?: string;
  error?: string;
}

export interface DownloadOutcome {
  destDir: string;
  results: DownloadResult[];
  urlMap: Map<string, string>;
  okCount: number;
  failedCount: number;
  totalBytes: number;
}

export interface DownloadOptions {
  concurrency?: number;
  perFileTimeoutMs?: number;
}

export async function downloadMedia(
  inventory: MediaInventory,
  destDir: string,
  options: DownloadOptions = {},
): Promise<DownloadOutcome> {
  await mkdir(destDir, { recursive: true });

  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const timeoutMs = options.perFileTimeoutMs ?? DEFAULT_TIMEOUT_MS;

  const uniqueUrls = [
    ...new Set([
      ...inventory.images,
      ...inventory.downloadables,
      ...inventory.backgrounds,
    ]),
  ];

  const taken = new Set<string>();
  const targets = uniqueUrls.map((url) => ({
    url,
    filename: allocateFilename(url, taken),
  }));

  const results: DownloadResult[] = new Array(targets.length);
  let nextIdx = 0;

  async function worker(): Promise<void> {
    while (true) {
      const cursor = nextIdx++;
      if (cursor >= targets.length) return;
      const { url, filename } = targets[cursor];
      results[cursor] = await downloadOne(url, filename, destDir, timeoutMs);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, targets.length) }, () =>
      worker(),
    ),
  );

  const urlMap = new Map<string, string>();
  let okCount = 0;
  let totalBytes = 0;
  for (const r of results) {
    if (r.status === "ok" && r.wpPath) {
      urlMap.set(r.url, r.wpPath);
      okCount++;
      totalBytes += r.byteSize ?? 0;
    }
  }

  return {
    destDir,
    results,
    urlMap,
    okCount,
    failedCount: results.length - okCount,
    totalBytes,
  };
}

async function downloadOne(
  url: string,
  filename: string,
  destDir: string,
  timeoutMs: number,
): Promise<DownloadResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!response.ok) {
      return { url, status: "failed", error: `HTTP ${response.status}` };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(join(destDir, filename), buffer);
    return {
      url,
      status: "ok",
      filename,
      wpPath: `${WP_UPLOAD_PREFIX}/${filename}`,
      byteSize: buffer.byteLength,
      contentType: response.headers.get("content-type") ?? undefined,
    };
  } catch (err) {
    return {
      url,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

function allocateFilename(url: string, taken: Set<string>): string {
  let raw = "asset";
  try {
    const path = new URL(url).pathname;
    const last = basename(path);
    if (last) raw = last;
  } catch {
    /* fall through with raw="asset" */
  }
  const ext = extname(raw);
  let base = (ext ? raw.slice(0, -ext.length) : raw).replace(
    /[^a-zA-Z0-9._-]/g,
    "-",
  );
  if (!base) base = "asset";

  let candidate = base + ext;
  let counter = 1;
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${base}-${counter}${ext}`;
    counter++;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}
