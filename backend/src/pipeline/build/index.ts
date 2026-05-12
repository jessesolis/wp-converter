import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CrawlResult } from "../crawl";
import {
  downloadAssetUrls,
  downloadMedia,
  type DownloadOutcome,
} from "../download";
import type { IngestResult } from "../ingest";
import type {
  AssetInventory,
  FormAnalysis,
  MediaInventory,
  NavAnalysis,
  PageContentZones,
} from "../parse";
import { buildMigrationChecklist } from "./checklist";
import { buildPageTemplates } from "./templates";
import {
  buildFunctionsPhp,
  buildIndexPhp,
  buildStyleCss,
  THEME_SLUG,
} from "./theme";
import { rewriteCssUrls } from "./url-rewriter";
import { buildWxrXml } from "./wxr";
import { zipDirectory } from "./zip";

export interface BuildInputs {
  jobRootDir: string;
  siteUrl: string;
  siteTitle: string;
  ingest: IngestResult;
  crawl: CrawlResult;
  assets: AssetInventory;
  media: MediaInventory;
  contentZones: PageContentZones[];
  formAnalysis: FormAnalysis;
  navAnalysis: NavAnalysis;
}

export interface BuildStats {
  ok: number;
  failed: number;
  totalBytes: number;
}

export interface BuildOutput {
  outputDir: string;
  zipPath: string;
  zipByteSize: number;
  css: BuildStats;
  js: BuildStats;
  mediaDownload: BuildStats;
  pageCount: number;
  zoneCount: number;
}

export async function buildWpPackage(
  inputs: BuildInputs,
): Promise<BuildOutput> {
  const outputDir = join(inputs.jobRootDir, "output");
  const themeDir = join(outputDir, "theme", THEME_SLUG);
  const cssDir = join(themeDir, "css");
  const jsDir = join(themeDir, "js");
  const templatesDir = join(themeDir, "templates");
  const mediaOutDir = join(outputDir, "media");

  await mkdir(cssDir, { recursive: true });
  await mkdir(jsDir, { recursive: true });
  await mkdir(templatesDir, { recursive: true });
  await mkdir(mediaOutDir, { recursive: true });

  const [cssOutcome, jsOutcome, mediaOutcome] = await Promise.all([
    downloadAssetUrls(inputs.assets.stylesheets, cssDir, {
      wpPathPrefix: `/wp-content/themes/${THEME_SLUG}/css`,
      fallbackExtension: ".css",
    }),
    downloadAssetUrls(inputs.assets.scripts, jsDir, {
      wpPathPrefix: `/wp-content/themes/${THEME_SLUG}/js`,
      fallbackExtension: ".js",
    }),
    downloadMedia(inputs.media, mediaOutDir),
  ]);

  const urlMap = new Map<string, string>([
    ...cssOutcome.urlMap,
    ...jsOutcome.urlMap,
    ...mediaOutcome.urlMap,
  ]);

  // Rewrite url() references inside the downloaded stylesheets so background
  // images and font references point at the local media / theme paths.
  for (const r of cssOutcome.results) {
    if (r.status !== "ok" || !r.filename) continue;
    const cssPath = join(cssDir, r.filename);
    const css = await readFile(cssPath, "utf8");
    const rewritten = rewriteCssUrls(css, r.url, urlMap);
    if (rewritten !== css) {
      await writeFile(cssPath, rewritten);
    }
  }

  // Inline <style> blocks (theme tokens etc) get concatenated into a
  // single stylesheet that is enqueued globally.
  const inlineFilename = "inline-bundle.css";
  if (inputs.assets.inlineStyles.length > 0) {
    const inlineCss = inputs.assets.inlineStyles
      .map((style, i) => `/* === inline block ${i + 1} === */\n${style}`)
      .join("\n\n");
    const rewritten = rewriteCssUrls(inlineCss, inputs.siteUrl, urlMap);
    await writeFile(join(cssDir, inlineFilename), rewritten);
  }

  const cssFilenames: string[] = [];
  for (const r of cssOutcome.results) {
    if (r.status === "ok" && r.filename) cssFilenames.push(r.filename);
  }
  if (inputs.assets.inlineStyles.length > 0) {
    cssFilenames.push(inlineFilename);
  }
  const jsFilenames: string[] = [];
  for (const r of jsOutcome.results) {
    if (r.status === "ok" && r.filename) jsFilenames.push(r.filename);
  }

  await writeFile(
    join(themeDir, "style.css"),
    buildStyleCss(inputs.siteTitle),
  );
  await writeFile(
    join(themeDir, "functions.php"),
    buildFunctionsPhp({
      siteTitle: inputs.siteTitle,
      cssFilenames,
      jsFilenames,
      inlineStyles: inputs.assets.inlineStyles,
    }),
  );
  await writeFile(join(themeDir, "index.php"), buildIndexPhp());

  const pageTitleByPath = new Map(
    inputs.ingest.pages.map((p) => [p.path, p.title]),
  );
  const { templates, pathToSlug } = buildPageTemplates(
    inputs.contentZones,
    pageTitleByPath,
    urlMap,
  );
  for (const t of templates) {
    await writeFile(join(templatesDir, t.filename), t.content);
  }

  const wxr = buildWxrXml({
    siteUrl: inputs.siteUrl,
    siteTitle: inputs.siteTitle,
    pages: inputs.ingest.pages,
    contentZones: inputs.contentZones,
    pathToSlug,
    urlMap,
    navAnalysis: inputs.navAnalysis,
  });
  await writeFile(join(outputDir, "import.xml"), wxr);

  const totalZones = inputs.contentZones.reduce(
    (n, p) => n + p.zones.length,
    0,
  );
  const limitations = collectLimitations(cssOutcome, jsOutcome, mediaOutcome);
  await writeFile(
    join(outputDir, "MIGRATION-CHECKLIST.md"),
    buildMigrationChecklist({
      siteTitle: inputs.siteTitle,
      pageCount: inputs.ingest.pages.length,
      zoneCount: totalZones,
      mediaCount: mediaOutcome.okCount,
      failedMedia: mediaOutcome.failedCount,
      formVariantCount: inputs.formAnalysis.variants.length,
      knownLimitations: limitations,
    }),
  );

  const zipPath = join(inputs.jobRootDir, "export.zip");
  const { byteSize } = await zipDirectory(outputDir, zipPath);

  return {
    outputDir,
    zipPath,
    zipByteSize: byteSize,
    css: outcomeStats(cssOutcome),
    js: outcomeStats(jsOutcome),
    mediaDownload: outcomeStats(mediaOutcome),
    pageCount: inputs.ingest.pages.length,
    zoneCount: totalZones,
  };
}

function outcomeStats(o: {
  okCount: number;
  failedCount: number;
  totalBytes: number;
}): BuildStats {
  return { ok: o.okCount, failed: o.failedCount, totalBytes: o.totalBytes };
}

function collectLimitations(
  cssOutcome: { failedCount: number },
  jsOutcome: { failedCount: number },
  mediaOutcome: DownloadOutcome,
): string[] {
  const out: string[] = [];
  if (cssOutcome.failedCount > 0) {
    out.push(
      `${cssOutcome.failedCount} stylesheet(s) failed to download. Pages may render with missing styles.`,
    );
  }
  if (jsOutcome.failedCount > 0) {
    out.push(
      `${jsOutcome.failedCount} script(s) failed to download. Some interactive components may not work.`,
    );
  }
  if (mediaOutcome.failedCount > 0) {
    const sample = mediaOutcome.results
      .filter((r) => r.status === "failed")
      .slice(0, 5)
      .map((r) => `\`${r.url}\` (${r.error ?? "unknown"})`)
      .join(", ");
    out.push(
      `${mediaOutcome.failedCount} media asset(s) failed to download. Examples: ${sample}.`,
    );
  }
  out.push(
    "Per-page content placement: WordPress renders all Classic blocks at the position of the first WP_CLASSIC_BLOCK placeholder. Pages with multiple content zones may need manual template editing for exact placement.",
  );
  return out;
}
