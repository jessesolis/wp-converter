import * as cheerio from "cheerio";

// Replace every `<use data-href="…#iconName">` in `html` with the inner SVG
// markup looked up in `iconMap` (sourced from #SiteIconTable on
// /wp-converter/). The parent `<svg>` element keeps its own attributes
// (viewBox, class, etc.) so the icon renders at the size + style the
// template specified. If `iconName` is not in the map, the `<use>` element
// is left in place — Scorpion's lazy-load JS may still resolve it at
// runtime, and an unrecognised icon is preferable to a missing one.
export function substituteSvgIcons(
  html: string,
  iconMap: Map<string, string>,
): string {
  if (iconMap.size === 0) return html;
  // Fast-path: skip the cheerio parse if there's nothing to do.
  if (!html.includes("data-href")) return html;

  const $ = cheerio.load(html, null, false);
  let changed = false;

  $("use[data-href]").each((_, el) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const $el = $(el as any);
    const href = $el.attr("data-href") ?? "";
    const hashIdx = href.lastIndexOf("#");
    if (hashIdx < 0) return;
    const name = href.slice(hashIdx + 1);
    if (!name) return;
    const replacement = iconMap.get(name);
    if (!replacement) return;
    $el.replaceWith(replacement);
    changed = true;
  });

  return changed ? $.html() : html;
}
