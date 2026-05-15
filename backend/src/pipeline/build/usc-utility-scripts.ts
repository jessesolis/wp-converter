import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Matches "/common/usc/p/<name>.<ext>" inside JS source. Scorpion's USC
// framework dynamically loads helper scripts via require2() against this
// hardcoded path; the references are baked into bundle JS strings, so the
// path needs both rewriting (so existing files resolve) and discovery (so
// runtime-only references that the crawler never saw still get downloaded).
const USC_PATH_RE = /\/common\/usc\/p\/([a-zA-Z0-9._-]+\.(?:js|html|css))/g;
const USC_PATH_PREFIX = "/common/usc/p/";

export interface UscUtilityScriptOptions {
  siteUrl: string;
  jsDir: string;
  // WP path that JS files are served from in the converted theme, e.g.
  // "/wp-content/themes/scorpion-converted/js". Used both as the literal
  // path that replaces "/common/usc/p/" inside downloaded JS, and as the
  // wpPath value recorded in the urlMap for newly-downloaded files.
  jsWpPathPrefix: string;
  // URL → filename for the JS bundles that have already been downloaded.
  // Used as the starting set so we don't re-fetch files Scorpion already
  // included in a page's static <script> tags.
  jsFilenameByUrl: Map<string, string>;
}

export interface UscUtilityScriptResult {
  // Newly-downloaded URL → on-disk filename. Caller merges into the global
  // jsFilenameByUrl + urlMap so per-page enqueue + HTML rewriting see them.
  newlyDownloaded: Map<string, string>;
  // Filenames of the JS files whose contents were rewritten (the existing
  // bundles plus any newly downloaded utility scripts).
  rewrittenFilenames: string[];
  // Names referenced inside JS that we tried but failed to download. Empty
  // when everything resolved.
  failedDownloads: { url: string; error: string }[];
}

// Discover, fetch, and rewrite Scorpion's runtime-loaded utility scripts.
//
// Operates in three phases:
//   1. Scan every JS file already in `jsDir` for `/common/usc/p/<name>.js`
//      occurrences. The set of unique basenames is the runtime dependency
//      list — these are the scripts Scorpion will require2() at runtime.
//   2. For each referenced basename that we don't already have a local
//      copy of, fetch it from `<siteUrl>/common/usc/p/<name>.js` and save
//      under `jsDir/<name>.js`.
//   3. Walk every JS file (existing + newly fetched) and replace the
//      literal "/common/usc/p/" prefix with `jsWpPathPrefix + "/"`. This
//      redirects both static references and dynamic require2() calls to
//      the theme path WordPress actually serves the files from.
export async function discoverAndRewriteUscUtilityScripts(
  options: UscUtilityScriptOptions,
): Promise<UscUtilityScriptResult> {
  const { siteUrl, jsDir, jsWpPathPrefix, jsFilenameByUrl } = options;
  const newlyDownloaded = new Map<string, string>();
  const failedDownloads: { url: string; error: string }[] = [];

  // Filenames we already have on disk (from the main JS download pass).
  // Newly fetched utility files are appended as we go so two references
  // to the same script don't redownload.
  const haveFilename = new Set<string>();
  for (const filename of jsFilenameByUrl.values()) {
    haveFilename.add(filename.toLowerCase());
  }

  // ---- Phase 1: scan every JS file for /common/usc/p/ references ----
  const jsFiles = (await readdir(jsDir)).filter((f) =>
    f.toLowerCase().endsWith(".js"),
  );
  const referencedBasenames = new Set<string>();
  const fileContents = new Map<string, string>();
  for (const filename of jsFiles) {
    const filePath = join(jsDir, filename);
    const content = await readFile(filePath, "utf8");
    fileContents.set(filename, content);
    for (const match of content.matchAll(USC_PATH_RE)) {
      const ref = match[1];
      if (ref.toLowerCase().endsWith(".js")) {
        referencedBasenames.add(ref);
      }
    }
  }

  // ---- Phase 2: download any referenced .js we don't already have ----
  const baseOrigin = new URL(siteUrl).origin;
  for (const basename of referencedBasenames) {
    if (haveFilename.has(basename.toLowerCase())) continue;
    const url = `${baseOrigin}${USC_PATH_PREFIX}${basename}`;
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "ScorpionWPConverter/0.1 (+https://scorpion.co; conversion-tool)",
        },
        redirect: "follow",
      });
      if (!response.ok) {
        failedDownloads.push({ url, error: `HTTP ${response.status}` });
        continue;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const destPath = join(jsDir, basename);
      await writeFile(destPath, buffer);
      newlyDownloaded.set(url, basename);
      haveFilename.add(basename.toLowerCase());

      // Load into fileContents so phase 3 picks it up too — newly fetched
      // utility scripts can reference further utility scripts.
      fileContents.set(basename, buffer.toString("utf8"));
    } catch (err) {
      failedDownloads.push({
        url,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ---- Phase 3: rewrite "/common/usc/p/" → theme JS WP path in every JS ----
  const themePrefix = `${jsWpPathPrefix}/`;
  const rewrittenFilenames: string[] = [];
  for (const [filename, content] of fileContents) {
    if (!content.includes(USC_PATH_PREFIX)) continue;
    const rewritten = content.split(USC_PATH_PREFIX).join(themePrefix);
    await writeFile(join(jsDir, filename), rewritten);
    rewrittenFilenames.push(filename);
  }

  return { newlyDownloaded, rewrittenFilenames, failedDownloads };
}
