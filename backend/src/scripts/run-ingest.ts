import { ingestWpConverter } from "../pipeline/ingest";

async function main() {
  const siteUrl = process.argv[2];
  if (!siteUrl) {
    console.error("Usage: tsx src/scripts/run-ingest.ts <site_url>");
    process.exit(1);
  }

  try {
    const result = await ingestWpConverter(siteUrl);
    console.log(`Site:             ${result.siteUrl}`);
    console.log(`Pages found:      ${result.pages.length}`);
    console.log(`Content zone IDs: ${result.contentZoneIds.size}`);
    console.log(`SVG icons:        ${result.iconMap.size}`);

    console.log("\nFirst 5 pages:");
    for (const p of result.pages.slice(0, 5)) {
      console.log(`  ${p.path}  →  ${p.title}`);
      console.log(`    canonical: ${p.canonical}`);
    }

    console.log("\nFirst 10 content zone IDs:");
    for (const id of [...result.contentZoneIds].slice(0, 10)) {
      console.log(`  ${id}`);
    }

    if (result.iconMap.size > 0) {
      console.log("\nFirst 10 SVG icons:");
      for (const name of [...result.iconMap.keys()].slice(0, 10)) {
        console.log(`  ${name}`);
      }
    }
  } catch (err) {
    console.error("Ingest failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
