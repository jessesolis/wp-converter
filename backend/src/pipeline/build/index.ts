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
import { buildPageHierarchy } from "./hierarchy";
import { stripBlockedDomainsFromJs } from "./strip-blocked-domains";
import { buildPageTemplates } from "./templates";
import {
  buildFunctionsPhp,
  buildIndexPhp,
  buildStyleCss,
  THEME_SLUG,
} from "./theme";
import { rewriteCssUrls } from "./url-rewriter";
import { discoverAndRewriteUscUtilityScripts } from "./usc-utility-scripts";
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

  // Downloaded asset URL → on-disk filename, derived once for per-page
  // handle mapping below.
  const cssFilenameByUrl = new Map<string, string>();
  for (const r of cssOutcome.results) {
    if (r.status === "ok" && r.filename) cssFilenameByUrl.set(r.url, r.filename);
  }
  const jsFilenameByUrl = new Map<string, string>();
  for (const r of jsOutcome.results) {
    if (r.status === "ok" && r.filename) jsFilenameByUrl.set(r.url, r.filename);
  }

  // Neutralise references to third-party domains we don't want running on
  // the converted site (e.g. AudioEye, which is tied to the original
  // Scorpion license). Replaces matching string literals inside JS with
  // empty strings so dynamic `n.src = "https://…audioeye.com/…"` style
  // injections become no-ops. Runs before the USC discovery pass so the
  // discoverer doesn't pick up dependencies of stripped scripts.
  // Configured list lives in backend/src/config/stripped-domains.ts.
  await stripBlockedDomainsFromJs(jsDir);

  // Discover, fetch, and rewrite Scorpion's runtime-loaded `/common/usc/p/`
  // utility scripts. Without this pass, dynamic require2() calls inside
  // downloaded JS bundles 404 against the WP host because the literal path
  // points back at the original site root. Run after the main JS download
  // so we can scan every bundle's contents for the dependency list.
  const jsWpPathPrefix = `/wp-content/themes/${THEME_SLUG}/js`;
  const uscOutcome = await discoverAndRewriteUscUtilityScripts({
    siteUrl: inputs.siteUrl,
    jsDir,
    jsWpPathPrefix,
    jsFilenameByUrl,
  });
  for (const [url, filename] of uscOutcome.newlyDownloaded) {
    jsFilenameByUrl.set(url, filename);
    // Also surface in the urlMap so any HTML still pointing at the
    // original /common/usc/p/<name>.js absolute URL gets rewritten by the
    // HTML rewriter to the theme path.
    urlMap.set(url, `${jsWpPathPrefix}/${filename}`);
  }

  // Build the hierarchy now so per-page inline CSS files can be named after
  // each page's templateSlug — that's the same key the enqueue logic uses
  // at request time.
  const pageTitleByPath = new Map(
    inputs.ingest.pages.map((p) => [p.path, p.title]),
  );
  const hierarchy = buildPageHierarchy(inputs.ingest.pages);

  // Per-page inline <style> blocks are written to inline-<slug>.css so each
  // page only loads its own inline tokens. Deduped against
  // inputs.assets.inlineStyles by index — identical blocks across pages
  // emit identical files (different filenames; that's fine).
  const inlineFilenameByPath = new Map<string, string>();
  for (const node of hierarchy.nodes) {
    const path = node.page.path;
    const indices = inputs.assets.pageInlineStyleIndices.get(path) ?? [];
    if (indices.length === 0) continue;
    const inlineCss = indices
      .map((idx, i) => {
        const block = inputs.assets.inlineStyles[idx] ?? "";
        return `/* === inline block ${i + 1} === */\n${block}`;
      })
      .join("\n\n");
    const rewritten = rewriteCssUrls(inlineCss, inputs.siteUrl, urlMap);
    const filename = `inline-${node.templateSlug}.css`;
    await writeFile(join(cssDir, filename), rewritten);
    inlineFilenameByPath.set(path, filename);
  }

  const cssFilenames: string[] = [];
  for (const r of cssOutcome.results) {
    if (r.status === "ok" && r.filename) cssFilenames.push(r.filename);
  }
  // Per-page inline CSS files are part of the registered stylesheet handle
  // set so the enqueue logic can reference them.
  for (const filename of inlineFilenameByPath.values()) {
    cssFilenames.push(filename);
  }
  const jsFilenames: string[] = [];
  for (const r of jsOutcome.results) {
    if (r.status === "ok" && r.filename) jsFilenames.push(r.filename);
  }

  // Slug → ordered list of CSS / JS filenames that the original Scorpion
  // page loaded, in document order. The per-page inline file is enqueued
  // FIRST so the bundles cascade over it — this matches the original site
  // where <style> blocks live in <head> and the main bundle is rendered
  // into <body>, making the bundle authoritative for any selector both
  // define. Reversing this order causes conflicts because inline blocks
  // contain selectors like `:root` token overrides that the bundle also
  // sets; if inline wins, the bundle's component styles fight the
  // inline-applied tokens.
  const cssFilenamesByTemplateSlug = new Map<string, string[]>();
  const jsFilenamesByTemplateSlug = new Map<string, string[]>();
  for (const node of hierarchy.nodes) {
    const path = node.page.path;

    const cssForPage: string[] = [];
    const inlineFile = inlineFilenameByPath.get(path);
    if (inlineFile) cssForPage.push(inlineFile);
    const cssUrls = inputs.assets.pageStylesheets.get(path) ?? [];
    for (const url of cssUrls) {
      const filename = cssFilenameByUrl.get(url);
      if (filename) cssForPage.push(filename);
    }
    cssFilenamesByTemplateSlug.set(node.templateSlug, cssForPage);

    const jsUrls = inputs.assets.pageScripts.get(path) ?? [];
    const jsForPage: string[] = [];
    for (const url of jsUrls) {
      const filename = jsFilenameByUrl.get(url);
      if (filename) jsForPage.push(filename);
    }
    jsFilenamesByTemplateSlug.set(node.templateSlug, jsForPage);
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
      perPage: {
        cssFilenamesByTemplateSlug,
        jsFilenamesByTemplateSlug,
      },
    }),
  );
  await writeFile(join(themeDir, "index.php"), buildIndexPhp());

  const iconMap = inputs.ingest.iconMap;
  const { templates } = buildPageTemplates(
    inputs.contentZones,
    hierarchy,
    pageTitleByPath,
    urlMap,
    iconMap,
  );
  for (const t of templates) {
    await writeFile(join(templatesDir, t.filename), t.content);
  }

  const wxr = buildWxrXml({
    siteUrl: inputs.siteUrl,
    siteTitle: inputs.siteTitle,
    hierarchy,
    contentZones: inputs.contentZones,
    urlMap,
    iconMap,
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
  return out;
}
