import { ingestWpConverter } from "../pipeline/ingest";
import { crawlSite } from "../pipeline/crawl";

async function main() {
  const siteUrl = process.argv[2];
  if (!siteUrl) {
    console.error("Usage: tsx src/scripts/run-crawl.ts <site_url>");
    process.exit(1);
  }

  try {
    console.log(`Ingesting ${siteUrl}…`);
    const ingest = await ingestWpConverter(siteUrl);
    console.log(
      `  pages: ${ingest.pages.length}  content zones: ${ingest.contentZoneIds.size}`,
    );

    if (ingest.pages.length === 0) {
      console.log("\nNo pages to crawl.");
      return;
    }

    console.log(`\nCrawling ${ingest.pages.length} pages…`);
    const crawl = await crawlSite(ingest);
    const elapsedSec = (
      (crawl.finishedAt.getTime() - crawl.startedAt.getTime()) /
      1000
    ).toFixed(1);
    console.log(`  done in ${elapsedSec}s`);

    const byStatus = new Map<string, number>();
    for (const p of crawl.pages) {
      byStatus.set(p.status, (byStatus.get(p.status) ?? 0) + 1);
    }
    console.log("\nResults by status:");
    for (const [status, count] of byStatus) {
      console.log(`  ${status.padEnd(20)} ${count}`);
    }

    const allStylesheets = new Set<string>();
    const allScripts = new Set<string>();
    const allImages = new Set<string>();
    let navsFound = 0;
    let navsMissing = 0;
    let okPages = 0;
    for (const p of crawl.pages) {
      if (p.status !== "ok") continue;
      okPages++;
      p.stylesheetUrls?.forEach((u) => allStylesheets.add(u));
      p.scriptUrls?.forEach((u) => allScripts.add(u));
      p.imageUrls?.forEach((u) => allImages.add(u));
      if (p.navHtml) navsFound++;
      else navsMissing++;
    }

    console.log("\nUnique assets across all OK pages:");
    console.log(`  stylesheets: ${allStylesheets.size}`);
    console.log(`  scripts:     ${allScripts.size}`);
    console.log(`  images:      ${allImages.size}`);
    console.log(`  nav present: ${navsFound}/${okPages}`);

    const failed = crawl.pages.filter((p) => p.status !== "ok");
    if (failed.length > 0) {
      console.log(`\nFailed pages (${failed.length}):`);
      for (const p of failed.slice(0, 15)) {
        const reason = p.error ?? `HTTP ${p.httpStatus ?? "?"}`;
        console.log(`  ${p.status.padEnd(18)} ${p.path}  (${reason})`);
      }
      if (failed.length > 15) {
        console.log(`  …and ${failed.length - 15} more`);
      }
    }
  } catch (err) {
    console.error("Crawl failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
