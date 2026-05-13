import * as cheerio from "cheerio";

export function rewriteHtmlUrls(
  html: string,
  pageUrl: string,
  urlMap: Map<string, string>,
): string {
  if (urlMap.size === 0) return html;
  // isDocument=false so fragments (content-zone inner HTML) don't get
  // auto-wrapped in <html><head></head><body>. Full documents are still
  // preserved because their existing wrapper tags are kept as-is.
  const $ = cheerio.load(html, null, false);

  $("img, source, audio, video, iframe, embed, script").each((_, el) => {
    rewriteAttr($(el), "src", pageUrl, urlMap);
  });
  // Scorpion uses `data-src` / `data-srcset` for lazy-load — the real URL
  // lives in those attrs and the JS swaps them into src/srcset at runtime.
  // Rewrite them too so downloaded assets resolve when the page loads.
  $("img[data-src], source[data-src]").each((_, el) => {
    rewriteAttr($(el), "data-src", pageUrl, urlMap);
  });
  $("a, link").each((_, el) => {
    rewriteAttr($(el), "href", pageUrl, urlMap);
  });
  $("object[data]").each((_, el) => {
    rewriteAttr($(el), "data", pageUrl, urlMap);
  });
  $("img[srcset], source[srcset]").each((_, el) => {
    const $el = $(el);
    const srcset = $el.attr("srcset");
    if (!srcset) return;
    const rewritten = rewriteSrcset(srcset, pageUrl, urlMap);
    if (rewritten !== srcset) $el.attr("srcset", rewritten);
  });
  $("img[data-srcset], source[data-srcset]").each((_, el) => {
    const $el = $(el);
    const srcset = $el.attr("data-srcset");
    if (!srcset) return;
    const rewritten = rewriteSrcset(srcset, pageUrl, urlMap);
    if (rewritten !== srcset) $el.attr("data-srcset", rewritten);
  });
  $("[style*='url(']").each((_, el) => {
    const $el = $(el);
    const style = $el.attr("style") ?? "";
    const rewritten = rewriteCssUrls(style, pageUrl, urlMap);
    if (rewritten !== style) $el.attr("style", rewritten);
  });

  return $.html();
}

export function rewriteSrcset(
  srcset: string,
  baseUrl: string,
  urlMap: Map<string, string>,
): string {
  if (srcset.includes("data:")) return srcset;
  return srcset
    .split(",")
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return trimmed;
      const [url, ...descriptor] = trimmed.split(/\s+/);
      const abs = resolveAbsolute(url, baseUrl);
      const newUrl = abs && urlMap.has(abs) ? urlMap.get(abs)! : url;
      return descriptor.length > 0
        ? `${newUrl} ${descriptor.join(" ")}`
        : newUrl;
    })
    .join(", ");
}

export function rewriteCssUrls(
  css: string,
  baseUrl: string,
  urlMap: Map<string, string>,
): string {
  return css.replace(
    /url\(\s*(['"]?)([^'")\s]+)\1\s*\)/g,
    (match, quote: string, urlVal: string) => {
      if (!urlVal || urlVal.startsWith("data:")) return match;
      const abs = resolveAbsolute(urlVal, baseUrl);
      if (abs && urlMap.has(abs)) {
        return `url(${quote}${urlMap.get(abs)}${quote})`;
      }
      return match;
    },
  );
}

function rewriteAttr(
  $el: cheerio.Cheerio<any>,
  attr: string,
  pageUrl: string,
  urlMap: Map<string, string>,
): void {
  const val = $el.attr(attr);
  if (!val) return;
  const abs = resolveAbsolute(val, pageUrl);
  if (abs && urlMap.has(abs)) {
    $el.attr(attr, urlMap.get(abs)!);
  }
}

function resolveAbsolute(href: string, baseUrl: string): string | null {
  if (
    !href ||
    href.startsWith("data:") ||
    href.startsWith("#") ||
    href.startsWith("javascript:") ||
    href.startsWith("mailto:") ||
    href.startsWith("tel:")
  ) {
    return null;
  }
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}
