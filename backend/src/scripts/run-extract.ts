import { ingestWpConverter } from "../pipeline/ingest";
import { crawlSite } from "../pipeline/crawl";
import { collectAssets, extractAllContentZones } from "../pipeline/parse";

async function main() {
  const siteUrl = process.argv[2];
  if (!siteUrl) {
    console.error("Usage: tsx src/scripts/run-extract.ts <site_url>");
    process.exit(1);
  }

  try {
    console.log(`Ingesting ${siteUrl}…`);
    const ingest = await ingestWpConverter(siteUrl);
    console.log(
      `  pages: ${ingest.pages.length}  content zone IDs: ${ingest.contentZoneIds.size}`,
    );
    if (ingest.contentZoneIds.size === 0) {
      console.log("\nNo content zone IDs registered for this site.");
    }
    if (ingest.pages.length === 0) {
      console.log("\nNo pages to crawl.");
      return;
    }

    console.log(`\nCrawling ${ingest.pages.length} pages…`);
    const crawl = await crawlSite(ingest);
    const crawlSec = (
      (crawl.finishedAt.getTime() - crawl.startedAt.getTime()) /
      1000
    ).toFixed(1);
    console.log(`  done in ${crawlSec}s`);

    const okPages = crawl.pages.filter((p) => p.status === "ok");
    const failedPages = crawl.pages.filter((p) => p.status !== "ok");
    console.log(`  ok: ${okPages.length}  failed: ${failedPages.length}`);
    if (failedPages.length > 0) {
      console.log("\nFailed pages:");
      for (const p of failedPages.slice(0, 10)) {
        const reason = p.error ?? `HTTP ${p.httpStatus ?? "?"}`;
        console.log(`  ${p.status.padEnd(18)} ${p.path}  (${reason})`);
      }
    }

    console.log(`\nExtracting content zones from ${okPages.length} OK pages…`);
    const extracted = extractAllContentZones(crawl, ingest.contentZoneIds);

    const totalZones = extracted.reduce((n, p) => n + p.zones.length, 0);
    const pagesWithZones = extracted.filter((p) => p.zones.length > 0).length;
    const pagesWithoutZones = extracted.length - pagesWithZones;
    const avg = extracted.length
      ? (totalZones / extracted.length).toFixed(1)
      : "0";

    console.log("\nContent zone summary:");
    console.log(`  registered zone IDs: ${ingest.contentZoneIds.size}`);
    console.log(`  total zone matches:  ${totalZones}`);
    console.log(`  pages with ≥1 zone:  ${pagesWithZones}`);
    console.log(`  pages with 0 zones:  ${pagesWithoutZones}`);
    console.log(`  avg zones per page:  ${avg}`);

    const perZoneCounts = new Map<string, { matches: number; pages: number }>();
    for (const id of ingest.contentZoneIds) {
      perZoneCounts.set(id, { matches: 0, pages: 0 });
    }
    for (const page of extracted) {
      const seenOnThisPage = new Set<string>();
      for (const z of page.zones) {
        const stat = perZoneCounts.get(z.zoneId);
        if (!stat) continue;
        stat.matches++;
        if (!seenOnThisPage.has(z.zoneId)) {
          stat.pages++;
          seenOnThisPage.add(z.zoneId);
        }
      }
    }

    console.log("\nPer-zone-ID counts:");
    const sortedIds = [...perZoneCounts.entries()].sort(
      (a, b) => b[1].matches - a[1].matches,
    );
    for (const [id, stat] of sortedIds) {
      const orphan = stat.matches === 0 ? "  (orphan)" : "";
      console.log(
        `  ${id.padEnd(28)} ${String(stat.matches).padStart(4)} matches on ${String(stat.pages).padStart(3)} pages${orphan}`,
      );
    }

    const firstWithZones = extracted.find((p) => p.zones.length > 0);
    if (firstWithZones) {
      console.log(`\nFirst page detail (path: ${firstWithZones.path}):`);
      console.log(`  zones: ${firstWithZones.zones.length}`);
      for (const z of firstWithZones.zones) {
        console.log(
          `    [${z.index}] ${z.zoneId.padEnd(24)} ${z.innerHtml.length.toLocaleString()} chars`,
        );
      }
      const templateBytes = firstWithZones.template.length;
      console.log(`  template after placeholder replacement: ${templateBytes.toLocaleString()} bytes`);
    }

    const assets = collectAssets(crawl);
    const inlineStyleBytes = assets.inlineStyles.reduce(
      (n, s) => n + s.length,
      0,
    );
    console.log("\nAsset inventory:");
    console.log(`  site hostname:      ${assets.siteHostname}`);
    console.log(`  stylesheets (same): ${assets.stylesheets.length}`);
    console.log(`  scripts (same):     ${assets.scripts.length}`);
    console.log(
      `  inline <style>:     ${assets.inlineStyles.length} unique blocks (${inlineStyleBytes.toLocaleString()} bytes)`,
    );
    console.log(`  stylesheets (3rd):  ${assets.excludedStylesheets.length}`);
    console.log(`  scripts (3rd):      ${assets.excludedScripts.length}`);

    if (assets.stylesheets.length > 0) {
      console.log(`\n  Same-origin stylesheets:`);
      for (const url of assets.stylesheets.slice(0, 15)) console.log(`    ${url}`);
      if (assets.stylesheets.length > 15) {
        console.log(`    …and ${assets.stylesheets.length - 15} more`);
      }
    }
    if (assets.scripts.length > 0) {
      console.log(`\n  Same-origin scripts:`);
      for (const url of assets.scripts.slice(0, 15)) console.log(`    ${url}`);
      if (assets.scripts.length > 15) {
        console.log(`    …and ${assets.scripts.length - 15} more`);
      }
    }
    if (assets.excludedStylesheets.length > 0) {
      console.log(`\n  Third-party stylesheets (excluded):`);
      for (const url of assets.excludedStylesheets.slice(0, 10)) console.log(`    ${url}`);
      if (assets.excludedStylesheets.length > 10) {
        console.log(`    …and ${assets.excludedStylesheets.length - 10} more`);
      }
    }
    if (assets.excludedScripts.length > 0) {
      console.log(`\n  Third-party scripts (excluded):`);
      for (const url of assets.excludedScripts.slice(0, 10)) console.log(`    ${url}`);
      if (assets.excludedScripts.length > 10) {
        console.log(`    …and ${assets.excludedScripts.length - 10} more`);
      }
    }
  } catch (err) {
    console.error("Extract failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
