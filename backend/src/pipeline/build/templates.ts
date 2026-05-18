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

export interface Cf7Lookup {
  postId: number;
  title: string;
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
  formIdToCf7Lookup: Map<string, Cf7Lookup> = new Map(),
): BuiltTemplates {
  const templates: PageTemplateOutput[] = [];

  for (const z of zones) {
    const node = hierarchy.byPath.get(normalizePath(z.path));
    if (!node) continue;
    const templateName =
      pageTitleByPath.get(z.path) || z.path || node.templateSlug;
    templates.push(
      buildPageTemplate(
        z,
        node.templateSlug,
        templateName,
        urlMap,
        iconMap,
        formIdToCf7Lookup,
      ),
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
  formIdToCf7Lookup: Map<string, Cf7Lookup>,
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

  // Swap Scorpion's contact form for the matching CF7 shortcode. Scorpion
  // wraps each contact panel in a <form> shell (ASP.NET WebForms) with the
  // actual field repeater in a <div class="…ui-contact-form…"> — surrounded
  // by the panel heading, description, and layout markup we want to keep.
  // So:
  //   1. Replace each <div class="ui-contact-form"> with the CF7 shortcode
  //      for the variant of its enclosing <form>.
  //   2. Unwrap that <form> (drop the tag + its hidden control inputs but
  //      keep its children) so the surrounding panel survives.
  //   3. Skip data-search forms (site search / blog filter).
  //   4. Fall back to whole-form replacement when no inner div matches —
  //      preserves coverage for sites that don't follow this markup.
  // Replacement strings are stashed in a sidecar map and re-injected after
  // cheerio serializes (cheerio escapes raw <?php). The shortcode includes
  // both `id` (preferred) and `title` (fallback for when the wordpress-
  // importer reassigns post_ids on a dirty target DB), plus html_id /
  // html_class so the rendered CF7 <form> can be styled alongside the
  // original Scorpion classes.
  const cf7Replacements = new Map<string, string>();
  const formsToUnwrap = new Set<unknown>();

  const makeShortcode = (lookup: Cf7Lookup): string =>
    `<?php echo do_shortcode('[contact-form-7 id="${lookup.postId}" title="${escapePhpSingleQuotes(lookup.title)}" html_id="Form" html_class="ui-contact-form"]'); ?>`;

  // Scorpion uses different ids for the inner field-repeater across
  // sections — `<div id="Form" …>` on /contact-us/ but
  // `<div id="ContactS21Form" …>` on the home page, etc. The class
  // `ui-contact-form` is the consistent signal.
  $("div.ui-contact-form").each((_, divEl) => {
    const $div = $(divEl);
    const $form = $div.closest("form");
    if ($form.length === 0) return;
    const formId = $form.attr("id");
    if (!formId) return;
    const lookup = formIdToCf7Lookup.get(formId);
    if (!lookup) return;
    const token = `WP_CF7_FORM_${cf7Replacements.size}`;
    cf7Replacements.set(token, makeShortcode(lookup));
    $div.replaceWith(`<!-- ${token} -->`);
    formsToUnwrap.add($form.get(0));
  });

  // Fallback: forms with no inner ui-contact-form div get whole-form swap.
  $("form").each((_, formEl) => {
    const $form = $(formEl);
    if ($form.attr("data-search") === "1") return;
    if (formsToUnwrap.has(formEl)) return;
    const id = $form.attr("id");
    if (!id) return;
    const lookup = formIdToCf7Lookup.get(id);
    if (!lookup) return;
    const token = `WP_CF7_FORM_${cf7Replacements.size}`;
    cf7Replacements.set(token, makeShortcode(lookup));
    $form.replaceWith(`<!-- ${token} -->`);
  });

  // Unwrap the outer <form> shells that contained an inner-div replacement.
  // Drop their hidden control inputs (e.g. ASP.NET _m_/_VIEWSTATE) — they
  // have no recipient on the WP side.
  for (const formEl of formsToUnwrap) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const $form = $(formEl as any);
    $form.find('input[type="hidden"]').remove();
    $form.replaceWith($form.contents());
  }

  html = $.html();
  for (const [token, shortcode] of cf7Replacements) {
    html = html.replace(`<!-- ${token} -->`, shortcode);
  }

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

function escapePhpSingleQuotes(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
