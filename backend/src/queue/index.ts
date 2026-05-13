import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "../config/env";

export const QUEUE_NAME = "scorpion-conversion";

// BullMQ requires `maxRetriesPerRequest: null` on the Redis connection it uses
// for blocking commands. We share one ioredis instance between the queue and
// the worker.
export const redisConnection = new IORedis(env.redisUrl, {
  maxRetriesPerRequest: null,
});

export interface ConversionJobData {
  jobId: string;
  siteUrl: string;
  siteTitle: string;
  uscVersion: string;
}

export const conversionQueue = new Queue<ConversionJobData>(QUEUE_NAME, {
  connection: redisConnection,
});

export async function closeQueue(): Promise<void> {
  await conversionQueue.close();
  redisConnection.disconnect();
}
