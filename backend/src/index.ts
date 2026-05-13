import express from "express";
import { env } from "./config/env";
import { closeDb, runMigrations } from "./db/client";
import { jobsRouter } from "./routes/jobs";

const app = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/jobs", jobsRouter);

async function main() {
  try {
    await runMigrations();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(
      `Could not run migrations against ${env.databaseUrl}.\n` +
        `  ${detail}\n` +
        `  Start the repo-root docker-compose ('docker compose up -d') or ` +
        `update backend/.env with a reachable Postgres URL.`,
    );
    process.exit(1);
  }

  app.listen(env.port, () => {
    console.log(`Backend listening on http://localhost:${env.port}`);
  });
}

async function shutdown() {
  await closeDb().catch(() => {});
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main();
