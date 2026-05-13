import { Router, type Request, type Response } from "express";
import { stat } from "node:fs/promises";
import { isUscVersion, type UscVersion } from "../config/usc-versions";
import { createJob, getJob } from "../db/job-store";
import { conversionQueue } from "../queue";

export const jobsRouter = Router();

interface ValidInput {
  siteUrl: string;
  siteTitle: string;
  uscVersion: UscVersion;
}

type Validation =
  | { ok: true; input: ValidInput }
  | { ok: false; error: string };

function validateBody(body: unknown): Validation {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Request body must be a JSON object" };
  }
  const { siteUrl, siteTitle, uscVersion } = body as Record<string, unknown>;

  if (typeof siteUrl !== "string" || !siteUrl.trim()) {
    return { ok: false, error: "siteUrl is required" };
  }
  try {
    new URL(siteUrl);
  } catch {
    return { ok: false, error: "siteUrl must be a valid URL" };
  }
  if (typeof siteTitle !== "string" || !siteTitle.trim()) {
    return { ok: false, error: "siteTitle is required" };
  }
  if (!isUscVersion(uscVersion)) {
    return { ok: false, error: "uscVersion must be one of the supported values" };
  }

  return {
    ok: true,
    input: {
      siteUrl: siteUrl.trim(),
      siteTitle: siteTitle.trim(),
      uscVersion,
    },
  };
}

function slugifyForFilename(value: string): string {
  const cleaned = value
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "export";
}

jobsRouter.post("/", async (req: Request, res: Response) => {
  const validated = validateBody(req.body);
  if (!validated.ok) {
    res.status(400).json({ error: validated.error });
    return;
  }

  const job = await createJob(validated.input);

  // The BullMQ jobId mirrors the DB UUID so this enqueue is idempotent across
  // retries from the client side.
  await conversionQueue.add(
    "conversion",
    {
      jobId: job.id,
      siteUrl: job.input.siteUrl,
      siteTitle: job.input.siteTitle,
      uscVersion: job.input.uscVersion,
    },
    {
      jobId: job.id,
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: { age: 60 * 60 * 24 },
      removeOnFail: { age: 60 * 60 * 24 * 7 },
    },
  );

  res.status(202).json({
    jobId: job.id,
    status: job.status,
  });
});

jobsRouter.get("/:id", async (req: Request, res: Response) => {
  const job = await getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json({
    jobId: job.id,
    status: job.status,
    siteUrl: job.input.siteUrl,
    siteTitle: job.input.siteTitle,
    uscVersion: job.input.uscVersion,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    error: job.error,
    downloadUrl:
      job.status === "ready" ? `/api/jobs/${job.id}/export` : null,
  });
});

jobsRouter.get("/:id/export", async (req: Request, res: Response) => {
  const job = await getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (job.status !== "ready" || !job.outputPath) {
    res
      .status(409)
      .json({ error: `Export not ready (status: ${job.status})` });
    return;
  }
  try {
    await stat(job.outputPath);
  } catch {
    res.status(410).json({ error: "Export file no longer exists" });
    return;
  }
  const filename = `${slugifyForFilename(job.input.siteTitle)}-wordpress.zip`;
  res.download(job.outputPath, filename, (err) => {
    if (err && !res.headersSent) {
      res.status(500).json({ error: "Download failed" });
    }
  });
});
