import { randomUUID } from "node:crypto";
import type { UscVersion } from "../config/usc-versions";
import type { IngestResult } from "../pipeline/ingest";

export type JobStatus =
  | "queued"
  | "ingesting"
  | "crawling"
  | "parsing"
  | "building"
  | "ready"
  | "failed";

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
  updatedAt: Date;
  ingestResult?: IngestResult;
  exportPath?: string;
  exportSize?: number;
  error?: string;
}

const store = new Map<string, JobRecord>();

export function createJob(input: JobInput): JobRecord {
  const now = new Date();
  const record: JobRecord = {
    id: randomUUID(),
    status: "queued",
    input,
    createdAt: now,
    updatedAt: now,
  };
  store.set(record.id, record);
  return record;
}

export function updateJob(
  id: string,
  patch: Partial<Omit<JobRecord, "id" | "createdAt">>,
): JobRecord {
  const existing = store.get(id);
  if (!existing) throw new Error(`Job not found: ${id}`);
  const updated: JobRecord = { ...existing, ...patch, updatedAt: new Date() };
  store.set(id, updated);
  return updated;
}

export function getJob(id: string): JobRecord | undefined {
  return store.get(id);
}
