import { Worker, type Job } from "bullmq";
import { updateJob } from "../db/job-store";
import { runConversion } from "../pipeline/run";
import { publishJobUpdate } from "./events";
import {
  QUEUE_NAME,
  redisConnection,
  type ConversionJobData,
} from "./index";

export function createConversionWorker(): Worker<ConversionJobData> {
  const worker = new Worker<ConversionJobData>(
    QUEUE_NAME,
    async (job: Job<ConversionJobData>) => {
      return runConversion({
        jobId: job.data.jobId,
        siteUrl: job.data.siteUrl,
        siteTitle: job.data.siteTitle,
      });
    },
    {
      connection: redisConnection,
      concurrency: 1,
    },
  );

  worker.on("active", (job) => {
    console.log(`[worker] active jobId=${job.data.jobId}`);
  });
  worker.on("completed", (job) => {
    console.log(`[worker] completed jobId=${job.data.jobId}`);
  });
  worker.on("failed", async (job, err) => {
    if (!job) {
      console.error("[worker] failed with no job context:", err);
      return;
    }
    const detail = err instanceof Error ? err.message : String(err);
    const attemptsMade = job.attemptsMade;
    const maxAttempts = job.opts.attempts ?? 1;
    const isFinal = attemptsMade >= maxAttempts;
    console.error(
      `[worker] failed jobId=${job.data.jobId} attempt=${attemptsMade}/${maxAttempts}: ${detail}`,
    );
    if (isFinal) {
      try {
        const row = await updateJob(job.data.jobId, {
          status: "failed",
          error: detail,
          completedAt: new Date(),
        });
        publishJobUpdate(row);
      } catch (e) {
        console.error(
          `[worker] failed to mark job failed jobId=${job.data.jobId}:`,
          e,
        );
      }
    }
  });

  return worker;
}
