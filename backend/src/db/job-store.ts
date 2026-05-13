import { eq } from "drizzle-orm";
import type { UscVersion } from "../config/usc-versions";
import { db } from "./client";
import { jobs, type JobRow } from "./schema";

export type JobStatus = JobRow["status"];

export interface JobInput {
  siteUrl: string;
  siteTitle: string;
  uscVersion: UscVersion;
}

export interface JobRecord {
  id: string;
  status: JobStatus;
  input: JobInput;
  createdAt: Date;
  completedAt: Date | null;
  outputPath: string | null;
  error: string | null;
}

export interface JobPatch {
  status?: JobStatus;
  outputPath?: string | null;
  completedAt?: Date | null;
  error?: string | null;
}

function rowToRecord(row: JobRow): JobRecord {
  return {
    id: row.id,
    status: row.status,
    input: {
      siteUrl: row.siteUrl,
      siteTitle: row.siteTitle,
      uscVersion: row.uscVersion as UscVersion,
    },
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    outputPath: row.outputPath,
    error: row.error,
  };
}

export async function createJob(input: JobInput): Promise<JobRecord> {
  const [row] = await db
    .insert(jobs)
    .values({
      status: "queued",
      siteUrl: input.siteUrl,
      siteTitle: input.siteTitle,
      uscVersion: input.uscVersion,
    })
    .returning();
  return rowToRecord(row);
}

export async function updateJob(
  id: string,
  patch: JobPatch,
): Promise<JobRecord> {
  const [row] = await db
    .update(jobs)
    .set(patch)
    .where(eq(jobs.id, id))
    .returning();
  if (!row) throw new Error(`Job not found: ${id}`);
  return rowToRecord(row);
}

export async function getJob(id: string): Promise<JobRecord | undefined> {
  const [row] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  return row ? rowToRecord(row) : undefined;
}
