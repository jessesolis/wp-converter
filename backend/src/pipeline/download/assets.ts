import { mkdir, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";

const DEFAULT_CONCURRENCY = 8;
const DEFAULT_TIMEOUT_MS = 30_000;
const USER_AGENT =
  "ScorpionWPConverter/0.1 (+https://scorpion.co; conversion-tool)";

export type AssetDownloadStatus = "ok" | "failed";

export interface AssetDownloadResult {
  url: string;
  status: AssetDownloadStatus;
  filename?: string;
  wpPath?: string;
  byteSize?: number;
  contentType?: string;
  error?: string;
}

export interface AssetDownloadOutcome {
  destDir: string;
  results: AssetDownloadResult[];
  urlMap: Map<string, string>;
  okCount: number;
  failedCount: number;
  totalBytes: number;
}

export interface AssetDownloadOptions {
  concurrency?: number;
  perFileTimeoutMs?: number;
  // WP-path prefix prepended to the saved filename in the urlMap.
  // Examples: "/wp-content/themes/scorpion-converted/css",
  //           "/wp-content/themes/scorpion-converted/js".
  wpPathPrefix: string;
  fallbackExtension?: string;
}

export async function downloadAssetUrls(
  urls: string[],
  destDir: string,
  options: AssetDownloadOptions,
): Promise<AssetDownloadOutcome> {
  await mkdir(destDir, { recursive: true });

  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const timeoutMs = options.perFileTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const taken = new Set<string>();

  const targets = urls.map((url) => ({
    url,
    filename: allocateFilename(url, taken, options.fallbackExtension),
  }));

  const results: AssetDownloadResult[] = new Array(targets.length);
  let nextIdx = 0;

  async function worker(): Promise<void> {
    while (true) {
      const cursor = nextIdx++;
      if (cursor >= targets.length) return;
      const { url, filename } = targets[cursor];
      results[cursor] = await downloadOne(
        url,
        filename,
        destDir,
        timeoutMs,
        options.wpPathPrefix,
      );
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
  wpPathPrefix: string,
): Promise<AssetDownloadResult> {
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
      wpPath: `${wpPathPrefix}/${filename}`,
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

function allocateFilename(
  url: string,
  taken: Set<string>,
  fallbackExt = "",
): string {
  let raw = "asset";
  try {
    const path = new URL(url).pathname;
    const last = basename(path);
    if (last) raw = last;
  } catch {
    /* keep default */
  }
  let ext = extname(raw);
  let base = (ext ? raw.slice(0, -ext.length) : raw).replace(
    /[^a-zA-Z0-9._-]/g,
    "-",
  );
  if (!base) base = "asset";
  if (!ext && fallbackExt) ext = fallbackExt;

  let candidate = base + ext;
  let counter = 1;
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${base}-${counter}${ext}`;
    counter++;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}
