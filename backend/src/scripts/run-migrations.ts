import { closeDb, runMigrations } from "../db/client";

async function main() {
  console.log("Running drizzle migrations…");
  await runMigrations();
  console.log("  done.");
  await closeDb();
}

main().catch(async (err) => {
  console.error("Migration failed:", err instanceof Error ? err.message : err);
  await closeDb().catch(() => {});
  process.exit(1);
});
