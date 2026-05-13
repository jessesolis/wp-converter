import { EventEmitter } from "node:events";
import type { JobRecord } from "../db/job-store";

export interface JobUpdate {
  type: "update";
  jobId: string;
  status: JobRecord["status"];
  error: string | null;
  downloadUrl: string | null;
  completedAt: string | null;
}

// In-process pub/sub for live job updates. The worker (same process as the
// HTTP server) emits one event per stage transition; the WebSocket route
// subscribes per-connection. Cross-process delivery would need Redis pub/sub
// or BullMQ's QueueEvents instead — fine for now since the worker is in-band.
class JobEventBus extends EventEmitter {}
const bus = new JobEventBus();

// Worker count is small; lift the default 10-listener cap so multiple
// browser tabs watching the same job don't trigger the warning.
bus.setMaxListeners(100);

export function publishJobUpdate(record: JobRecord): void {
  const update: JobUpdate = {
    type: "update",
    jobId: record.id,
    status: record.status,
    error: record.error,
    downloadUrl:
      record.status === "ready" ? `/api/jobs/${record.id}/export` : null,
    completedAt: record.completedAt ? record.completedAt.toISOString() : null,
  };
  bus.emit(record.id, update);
}

export function subscribeJob(
  jobId: string,
  listener: (update: JobUpdate) => void,
): () => void {
  bus.on(jobId, listener);
  return () => {
    bus.off(jobId, listener);
  };
}
