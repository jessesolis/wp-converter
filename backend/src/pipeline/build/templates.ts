import * as cheerio from "cheerio";
import type { PageContentZones } from "../parse";
import { rewriteHtmlUrls } from "./url-rewriter";
import { sanitizeZoneId } from "./zone-meta";

const PLACEHOLDER_PATTERN = /<!--\s*WP_CLASSIC_BLOCK_(\d+)\s*-->/g;

export interface PageTemplateOutput {
  filename: string;
  slug: string;
  templateName: string;
  content: string;
}

export interface BuiltTemplates {
  templates: PageTemplateOutput[];
  // path → slug mapping so the WXR builder can reference templates/page-{slug}.php
  pathToSlug: Map<string, string>;
}

export function buildPageTemplates(
  pages: PageContentZones[],
  pageTitleByPath: Map<string, string>,
  urlMap: Map<string, string>,
): BuiltTemplates {
  const takenSlugs = new Set<string>();
  const templates: PageTemplateOutput[] = [];
  const pathToSlug = new Map<string, string>();

  for (const page of pages) {
    const slug = allocateSlug(page.path, takenSlugs);
    pathToSlug.set(page.path, slug);
    const templateName = pageTitleByPath.get(page.path) || page.path || slug;
    templates.push(buildPageTemplate(page, slug, templateName, urlMap));
  }

  return { templates, pathToSlug };
}

function buildPageTemplate(
  page: PageContentZones,
  slug: string,
  templateName: string,
  urlMap: Map<string, string>,
): PageTemplateOutput {
  let html = rewriteHtmlUrls(page.template, page.pageUrl, urlMap);

  // Strip externally-loaded CSS/JS — WordPress wp_enqueue handles those.
  // Strip <style> blocks too — the orchestrator writes them out as a
  // single inline-bundle.css that is enqueued globally.
  const $ = cheerio.load(html);
  $('link[rel="stylesheet"]').remove();
  $("script[src]").remove();
  $("style").remove();
  html = $.html();

  // Inject wp_head() / wp_footer() so the theme's enqueued assets load.
  html = html.replace(/<\/head>/i, "<?php wp_head(); ?>\n</head>");
  html = html.replace(/<\/body>/i, "<?php wp_footer(); ?>\n</body>");

  // Replace each WP_CLASSIC_BLOCK_<index> placeholder with a per-zone
  // shortcode call. The zone HTML lives in postmeta `_scorpion_zone_<id>`
  // (emitted by the WXR builder); the shortcode handler in functions.php
  // echoes it. This preserves exact per-zone placement on multi-zone pages.
  html = html.replace(PLACEHOLDER_PATTERN, (_match, indexStr: string) => {
    const i = Number.parseInt(indexStr, 10);
    const zone = page.zones[i];
    if (!zone) return "";
    const safeId = sanitizeZoneId(zone.zoneId);
    return `<?php echo do_shortcode('[scorpion_zone id="${safeId}"]'); ?>`;
  });

  const header = `<?php
/* Template Name: ${escapePhpComment(templateName)} */
?>
`;

  return {
    filename: `page-${slug}.php`,
    slug,
    templateName,
    content: header + html,
  };
}

function allocateSlug(path: string, taken: Set<string>): string {
  let base = path.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!base) base = "home";
  base = base
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!base) base = "page";

  let candidate = base;
  let counter = 1;
  while (taken.has(candidate)) {
    candidate = `${base}-${counter}`;
    counter++;
  }
  taken.add(candidate);
  return candidate;
}

function escapePhpComment(value: string): string {
  return value.replace(/\*\//g, "*\\/");
}
