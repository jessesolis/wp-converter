CREATE TYPE "public"."job_status" AS ENUM('queued', 'framework_check', 'ingest', 'crawl', 'parse', 'download', 'build', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"site_url" text NOT NULL,
	"site_title" text NOT NULL,
	"usc_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"error" text,
	"output_path" text
);
