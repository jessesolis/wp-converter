import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as cheerio from "cheerio";
import {
  STRIPPED_DOMAINS,
  contentReferencesStrippedDomain,
  urlMatchesStrippedDomain,
} from "../../config/stripped-domains";

// Remove every reference to a stripped domain from an HTML fragment.
// Strips:
//   - <script src="…stripped-domain…"> tags (entire element removed)
//   - <link href="…stripped-domain…"> tags (preconnect, stylesheet, etc.)
//   - inline <script> blocks whose body mentions a stripped domain
//   - inline <style> blocks whose body mentions a stripped domain
//
// Leaves harmless DOM artefacts in place (e.g. <div id="audioeye_*"> hidden
// messages used by the widget's screen-reader prompts) — they don't load
// any third-party code and are invisible without the runtime widget.
export function stripBlockedDomainContent(html: string): string {
  if (!html) return html;
  const $ = cheerio.load(html, null, false);

  $("script[src]").each((_, el) => {
    const src = $(el).attr("src") ?? "";
    if (urlMatchesStrippedDomain(src)) $(el).remove();
  });
  $("link[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (urlMatchesStrippedDomain(href)) $(el).remove();
  });
  $("script:not([src])").each((_, el) => {
    const text = $(el).html() ?? "";
    if (contentReferencesStrippedDomain(text)) $(el).remove();
  });
  $("style").each((_, el) => {
    const text = $(el).html() ?? "";
    if (contentReferencesStrippedDomain(text)) $(el).remove();
  });

  return $.html();
}

// Matches quoted string literals containing a stripped-domain hostname.
// Handles single, double, and backtick quotes. Replacement collapses each
// match to an empty string of the same quote type, so JS like
// `n.src = "https://wsmcdn.audioeye.com/aem.js"` becomes `n.src = ""` —
// neutralising the dynamic <script> injection at runtime.
function buildStringLiteralRe(): RegExp {
  const domainAlt = STRIPPED_DOMAINS.map((d) =>
    d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  ).join("|");
  return new RegExp(
    `(["'\`])([^"'\`\\n\\r]*(?:${domainAlt})[^"'\`\\n\\r]*)\\1`,
    "gi",
  );
}

export interface StripBlockedJsResult {
  rewrittenFilenames: string[];
  occurrences: number;
}

// Walks every .js file in `jsDir` and replaces string literals containing
// a stripped-domain hostname with an empty string. Returns the list of
// files modified plus the total replacement count for logging.
export async function stripBlockedDomainsFromJs(
  jsDir: string,
): Promise<StripBlockedJsResult> {
  if (STRIPPED_DOMAINS.length === 0) {
    return { rewrittenFilenames: [], occurrences: 0 };
  }
  const literalRe = buildStringLiteralRe();
  const rewrittenFilenames: string[] = [];
  let occurrences = 0;

  const files = (await readdir(jsDir)).filter((f) =>
    f.toLowerCase().endsWith(".js"),
  );

  for (const filename of files) {
    const filePath = join(jsDir, filename);
    const original = await readFile(filePath, "utf8");
    if (!contentReferencesStrippedDomain(original)) continue;

    let fileCount = 0;
    const rewritten = original.replace(literalRe, (_match, quote: string) => {
      fileCount++;
      return `${quote}${quote}`;
    });
    if (rewritten !== original) {
      await writeFile(filePath, rewritten);
      rewrittenFilenames.push(filename);
      occurrences += fileCount;
    }
  }

  return { rewrittenFilenames, occurrences };
}
