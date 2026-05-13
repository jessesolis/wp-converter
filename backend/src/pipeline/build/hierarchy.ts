import type { ScorpionPage } from "../ingest";

// One node per real page from the Scorpion sitemap. The hierarchy walk
// assigns parent post_ids based on path containment so WordPress can resolve
// nested URLs (`/a/b/c/`) via post_name + post_parent lookup at each level.
export interface PageNode {
  // Normalized path with leading + trailing slash, e.g. "/", "/about-us/",
  // "/services/water/". This is the canonical key for `byPath`.
  path: string;
  // Flat slug used for the per-page template filename
  // (templates/page-<templateSlug>.php). Stays flat to avoid filesystem
  // collisions across deep paths.
  templateSlug: string;
  // 1-based unique post_id. Parents are always assigned before children.
  postId: number;
  // WordPress post_name: last URL segment only (or "home" for "/").
  // Must be unique within parentPostId — disambiguated with `-1`, `-2`, …
  // if collisions occur.
  postName: string;
  // 0 = top-level. Non-zero = the parent's postId. If a path's parent is
  // missing from the sitemap, parentPostId is 0 (page falls back to
  // top-level — WP serves it at /<postName>/ instead of the nested URL).
  parentPostId: number;
  // The original ingest record. Used by the WXR builder for title /
  // canonical / Yoast meta. v1 emits one node per real ingest page; no
  // stub-page synthesis for missing intermediates.
  page: ScorpionPage;
}

export interface PageHierarchy {
  nodes: PageNode[];
  byPath: Map<string, PageNode>;
  // Largest post_id used. Downstream emitters (e.g. nav menu items in the
  // WXR) start their post_ids at maxPostId + 1.
  maxPostId: number;
}

export function buildPageHierarchy(pages: ScorpionPage[]): PageHierarchy {
  const realByPath = new Map<string, ScorpionPage>();
  for (const p of pages) realByPath.set(normalizePath(p.path), p);

  // Parents must be inserted before their children so post_id allocation is
  // topologically valid. Sort by depth, then alphabetically for determinism.
  const sortedPaths = [...realByPath.keys()].sort((a, b) => {
    const da = depth(a);
    const db = depth(b);
    if (da !== db) return da - db;
    return a.localeCompare(b);
  });

  const byPath = new Map<string, PageNode>();
  const nodes: PageNode[] = [];
  const takenTemplateSlugs = new Set<string>();
  const takenPostNameByParent = new Map<number, Set<string>>();

  for (const path of sortedPaths) {
    const page = realByPath.get(path)!;
    const segments = path.split("/").filter(Boolean);

    let parentPostId = 0;
    if (segments.length > 1) {
      const parentPath = "/" + segments.slice(0, -1).join("/") + "/";
      const parent = byPath.get(parentPath);
      if (parent) parentPostId = parent.postId;
      // else: missing parent — leave at 0 (URL flattens to top-level)
    }

    const lastSegment = segments[segments.length - 1] ?? "";
    let postName = sanitizeSlug(lastSegment) || "home";

    let nameSet = takenPostNameByParent.get(parentPostId);
    if (!nameSet) {
      nameSet = new Set<string>();
      takenPostNameByParent.set(parentPostId, nameSet);
    }
    let candidate = postName;
    let counter = 1;
    while (nameSet.has(candidate)) {
      candidate = `${postName}-${counter}`;
      counter++;
    }
    postName = candidate;
    nameSet.add(postName);

    const templateSlug = allocateTemplateSlug(path, takenTemplateSlugs);

    const node: PageNode = {
      path,
      templateSlug,
      postId: nodes.length + 1,
      postName,
      parentPostId,
      page,
    };
    nodes.push(node);
    byPath.set(path, node);
  }

  return {
    nodes,
    byPath,
    maxPostId: nodes.length,
  };
}

export function normalizePath(path: string): string {
  if (!path || path === "/") return "/";
  const trimmed = path.replace(/^\/+|\/+$/g, "");
  return "/" + trimmed + "/";
}

function depth(path: string): number {
  return path.split("/").filter(Boolean).length;
}

function sanitizeSlug(segment: string): string {
  return segment
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function allocateTemplateSlug(path: string, taken: Set<string>): string {
  let base = path.replace(/^\/+|\/+$/g, "");
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
