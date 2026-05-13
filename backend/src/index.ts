import express from "express";
import { env } from "./config/env";
import { closeDb, runMigrations } from "./db/client";
import { closeQueue } from "./queue";
import { createConversionWorker } from "./queue/worker";
import { jobsRouter } from "./routes/jobs";
import { attachJobEventsWss } from "./routes/jobs-ws";
import type { Server } from "node:http";
import type { Worker } from "bullmq";
import type { WebSocketServer } from "ws";

const app = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/jobs", jobsRouter);

let worker: Worker | null = null;
let server: Server | null = null;
let wss: WebSocketServer | null = null;

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

  worker = createConversionWorker();
  worker.on("ready", () => console.log("[worker] ready"));
  worker.on("error", (err) => console.error("[worker] error:", err));

  server = app.listen(env.port, () => {
    console.log(`Backend listening on http://localhost:${env.port}`);
  });

  wss = attachJobEventsWss(server);
}

async function shutdown() {
  console.log("Shutting down…");
  if (wss) {
    await new Promise<void>((resolve) => wss!.close(() => resolve()));
  }
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
  if (worker) {
    await worker.close().catch(() => {});
  }
  await closeQueue().catch(() => {});
  await closeDb().catch(() => {});
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main();
