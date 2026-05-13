import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateJob } from "../db/job-store";
import { buildWpPackage } from "./build";
import { crawlSite } from "./crawl";
import { ingestWpConverter } from "./ingest";
import {
  analyzeForms,
  analyzeNavigation,
  collectAssets,
  collectMedia,
  extractAllContentZones,
} from "./parse";

export interface RunConversionInput {
  jobId: string;
  siteUrl: string;
  siteTitle: string;
}

export interface RunConversionOutput {
  zipPath: string;
  zipByteSize: number;
  pageCount: number;
  zoneCount: number;
}

// Single orchestration of the conversion pipeline. Writes stage transitions
// to the `jobs` row as it progresses. Throws on any stage failure — the
// caller (the BullMQ worker) is responsible for marking the row failed on
// the final retry.
export async function runConversion(
  input: RunConversionInput,
): Promise<RunConversionOutput> {
  const { jobId, siteUrl, siteTitle } = input;

  await updateJob(jobId, { status: "ingest" });
  const ingest = await ingestWpConverter(siteUrl);

  await updateJob(jobId, { status: "crawl" });
  const crawl = await crawlSite(ingest);

  await updateJob(jobId, { status: "parse" });
  const assets = collectAssets(crawl);
  const media = collectMedia(crawl);
  const contentZones = extractAllContentZones(crawl, ingest.contentZoneIds);
  const formAnalysis = analyzeForms(crawl);
  const navAnalysis = analyzeNavigation(crawl);

  await updateJob(jobId, { status: "build" });
  const jobRootDir = join(tmpdir(), "scorpion-conversions", jobId);
  const buildOutput = await buildWpPackage({
    jobRootDir,
    siteUrl: ingest.siteUrl,
    siteTitle,
    ingest,
    crawl,
    assets,
    media,
    contentZones,
    formAnalysis,
    navAnalysis,
  });

  await updateJob(jobId, {
    status: "ready",
    outputPath: buildOutput.zipPath,
    completedAt: new Date(),
  });

  return {
    zipPath: buildOutput.zipPath,
    zipByteSize: buildOutput.zipByteSize,
    pageCount: buildOutput.pageCount,
    zoneCount: buildOutput.zoneCount,
  };
}
