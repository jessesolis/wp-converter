import { Router, type Request, type Response } from "express";
import { isUscVersion, type UscVersion } from "../config/usc-versions";
import { createJob, updateJob } from "../db/job-store";
import {
  IngestFetchError,
  IngestParseError,
  ingestWpConverter,
  type IngestResult,
} from "../pipeline/ingest";

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

function serializeIngest(result: IngestResult) {
  return {
    siteUrl: result.siteUrl,
    pages: result.pages,
    contentZoneIds: [...result.contentZoneIds],
  };
}

jobsRouter.post("/", async (req: Request, res: Response) => {
  const validated = validateBody(req.body);
  if (!validated.ok) {
    res.status(400).json({ error: validated.error });
    return;
  }

  const job = createJob(validated.input);
  updateJob(job.id, { status: "ingesting" });

  try {
    const ingestResult = await ingestWpConverter(validated.input.siteUrl);
    const completed = updateJob(job.id, {
      status: "ingest_complete",
      ingestResult,
    });
    res.status(201).json({
      jobId: completed.id,
      status: completed.status,
      result: serializeIngest(ingestResult),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error";
    updateJob(job.id, { status: "failed", error: detail });

    if (err instanceof IngestFetchError) {
      res.status(502).json({
        error: detail,
        jobId: job.id,
        category: err.category,
        retryable: err.retryable,
      });
      return;
    }
    if (err instanceof IngestParseError) {
      res.status(502).json({ error: detail, jobId: job.id });
      return;
    }
    res.status(500).json({ error: detail, jobId: job.id });
  }
});
