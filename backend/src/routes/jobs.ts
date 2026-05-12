import { Router, type Request, type Response } from "express";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isUscVersion, type UscVersion } from "../config/usc-versions";
import { createJob, getJob, updateJob } from "../db/job-store";
import { buildWpPackage } from "../pipeline/build";
import { crawlSite } from "../pipeline/crawl";
import {
  IngestFetchError,
  IngestParseError,
  ingestWpConverter,
  type IngestResult,
} from "../pipeline/ingest";
import {
  analyzeForms,
  analyzeNavigation,
  collectAssets,
  collectMedia,
  extractAllContentZones,
} from "../pipeline/parse";

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

  const job = createJob(validated.input);

  try {
    updateJob(job.id, { status: "ingesting" });
    const ingest = await ingestWpConverter(validated.input.siteUrl);
    updateJob(job.id, { ingestResult: ingest });

    updateJob(job.id, { status: "crawling" });
    const crawl = await crawlSite(ingest);

    updateJob(job.id, { status: "parsing" });
    const assets = collectAssets(crawl);
    const media = collectMedia(crawl);
    const contentZones = extractAllContentZones(crawl, ingest.contentZoneIds);
    const formAnalysis = analyzeForms(crawl);
    const navAnalysis = analyzeNavigation(crawl);

    updateJob(job.id, { status: "building" });
    const jobRootDir = join(tmpdir(), "scorpion-conversions", job.id);
    const buildOutput = await buildWpPackage({
      jobRootDir,
      siteUrl: ingest.siteUrl,
      siteTitle: validated.input.siteTitle,
      ingest,
      crawl,
      assets,
      media,
      contentZones,
      formAnalysis,
      navAnalysis,
    });

    updateJob(job.id, {
      status: "ready",
      exportPath: buildOutput.zipPath,
      exportSize: buildOutput.zipByteSize,
    });

    res.status(201).json({
      jobId: job.id,
      status: "ready",
      ingest: serializeIngest(ingest),
      build: {
        downloadUrl: `/api/jobs/${job.id}/export`,
        byteSize: buildOutput.zipByteSize,
        pageCount: buildOutput.pageCount,
        zoneCount: buildOutput.zoneCount,
        css: buildOutput.css,
        js: buildOutput.js,
        media: buildOutput.mediaDownload,
      },
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

jobsRouter.get("/:id/export", async (req: Request, res: Response) => {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (job.status !== "ready" || !job.exportPath) {
    res
      .status(409)
      .json({ error: `Export not ready (status: ${job.status})` });
    return;
  }
  try {
    await stat(job.exportPath);
  } catch {
    res.status(410).json({ error: "Export file no longer exists" });
    return;
  }
  const filename = `${slugifyForFilename(job.input.siteTitle)}-wordpress.zip`;
  res.download(job.exportPath, filename, (err) => {
    if (err && !res.headersSent) {
      res.status(500).json({ error: "Download failed" });
    }
  });
});
