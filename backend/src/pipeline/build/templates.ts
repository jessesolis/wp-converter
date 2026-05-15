import * as cheerio from "cheerio";
import type { PageContentZones } from "../parse";
import { normalizePath, type PageHierarchy } from "./hierarchy";
import { stripBlockedDomainContent } from "./strip-blocked-domains";
import { substituteSvgIcons } from "./svg-icons";
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
}

// One PHP template per real page. Filename uses the flat templateSlug from
// the hierarchy (e.g. `templates/page-residential-plumbing-services-drain-lines.php`)
// to avoid filesystem collisions on deep nested URLs.
export function buildPageTemplates(
  zones: PageContentZones[],
  hierarchy: PageHierarchy,
  pageTitleByPath: Map<string, string>,
  urlMap: Map<string, string>,
  iconMap: Map<string, string>,
): BuiltTemplates {
  const templates: PageTemplateOutput[] = [];

  for (const z of zones) {
    const node = hierarchy.byPath.get(normalizePath(z.path));
    if (!node) continue;
    const templateName =
      pageTitleByPath.get(z.path) || z.path || node.templateSlug;
    templates.push(
      buildPageTemplate(z, node.templateSlug, templateName, urlMap, iconMap),
    );
  }

  return { templates };
}

function buildPageTemplate(
  page: PageContentZones,
  slug: string,
  templateName: string,
  urlMap: Map<string, string>,
  iconMap: Map<string, string>,
): PageTemplateOutput {
  let html = rewriteHtmlUrls(page.template, page.pageUrl, urlMap);
  html = substituteSvgIcons(html, iconMap);
  html = stripBlockedDomainContent(html);

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

function escapePhpComment(value: string): string {
  return value.replace(/\*\//g, "*\\/");
}
