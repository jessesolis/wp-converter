import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Stage names match ARCHITECTURE.md §"Job stages". 'framework_check' and
// 'download' are declared up front even though the current pipeline does not
// emit them as distinct states yet — keeping the enum stable avoids a future
// migration when those stages are wired.
export const jobStatusEnum = pgEnum("job_status", [
  "queued",
  "framework_check",
  "ingest",
  "crawl",
  "parse",
  "download",
  "build",
  "ready",
  "failed",
]);

export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  status: jobStatusEnum("status").notNull().default("queued"),
  siteUrl: text("site_url").notNull(),
  siteTitle: text("site_title").notNull(),
  uscVersion: text("usc_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  error: text("error"),
  outputPath: text("output_path"),
});

export type JobRow = typeof jobs.$inferSelect;
export type NewJobRow = typeof jobs.$inferInsert;
