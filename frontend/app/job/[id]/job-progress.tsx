"use client";

import { useEffect, useState } from "react";

interface JobState {
  jobId: string;
  status:
    | "queued"
    | "framework_check"
    | "ingest"
    | "crawl"
    | "parse"
    | "download"
    | "build"
    | "ready"
    | "failed";
  siteUrl: string;
  siteTitle: string;
  uscVersion: string;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
  downloadUrl: string | null;
}

// Stages shown in the progress list. `framework_check` and `download` are part
// of the DB enum but the current pipeline does not emit them — they are
// omitted from the visual so the list reflects what the worker actually does.
const VISIBLE_STAGES = ["ingest", "crawl", "parse", "build"] as const;
type VisibleStage = (typeof VISIBLE_STAGES)[number];

export function JobProgress({ jobId }: { jobId: string }) {
  const [state, setState] = useState<JobState | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          if (!cancelled) setFetchError(body.error ?? `HTTP ${res.status}`);
          return;
        }
        const body = (await res.json()) as JobState;
        if (cancelled) return;
        setState(body);
        setFetchError(null);
        if (body.status !== "ready" && body.status !== "failed") {
          timer = setTimeout(poll, 1000);
        }
      } catch (err) {
        if (!cancelled) {
          setFetchError(err instanceof Error ? err.message : "Network error");
          timer = setTimeout(poll, 2000);
        }
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId]);

  if (!state) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-gray-500">Loading…</p>
        {fetchError && (
          <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {fetchError}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
          Conversion in progress
        </p>
        <h1 className="text-xl font-semibold text-gray-900">
          {state.siteTitle}
        </h1>
        <p className="truncate text-sm text-gray-500">{state.siteUrl}</p>
      </header>

      <StageList status={state.status} />

      {state.status === "ready" && state.downloadUrl && (
        <a
          href={state.downloadUrl}
          className="block rounded-md border border-gray-900 bg-gray-900 px-4 py-3 text-center text-sm font-medium text-white shadow-sm transition hover:bg-gray-800"
        >
          Download WordPress package
        </a>
      )}

      {state.status === "failed" && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-medium">Conversion failed</p>
          <p className="mt-1 text-red-700">
            {state.error ?? "Unknown error"}
          </p>
        </div>
      )}

      <p className="text-xs text-gray-400">
        Job ID: <code>{state.jobId}</code>
      </p>
    </div>
  );
}

function StageList({ status }: { status: JobState["status"] }) {
  const currentIndex = stageIndex(status);
  return (
    <ol className="space-y-2">
      {VISIBLE_STAGES.map((stage, i) => {
        const state = stageRowState(i, currentIndex, status);
        return (
          <li
            key={stage}
            className="flex items-center gap-3 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
          >
            <StageIcon state={state} />
            <span
              className={
                state === "pending"
                  ? "text-gray-400"
                  : state === "active"
                    ? "font-medium text-gray-900"
                    : "text-gray-700"
              }
            >
              {STAGE_LABELS[stage]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function stageIndex(status: JobState["status"]): number {
  if (status === "queued" || status === "framework_check") return -1;
  if (status === "ready") return VISIBLE_STAGES.length;
  if (status === "failed") return -2;
  // `download` is rolled into `build` for the current pipeline.
  if (status === "download") return VISIBLE_STAGES.indexOf("build");
  const idx = VISIBLE_STAGES.indexOf(status as VisibleStage);
  return idx >= 0 ? idx : -1;
}

type RowState = "done" | "active" | "pending" | "error";

function stageRowState(
  rowIndex: number,
  currentIndex: number,
  status: JobState["status"],
): RowState {
  if (status === "failed") {
    // Highlight the stage that was running when we failed; the API does not
    // record per-stage failure today, so we just leave all as pending.
    return rowIndex === 0 ? "error" : "pending";
  }
  if (currentIndex < 0) return "pending";
  if (rowIndex < currentIndex) return "done";
  if (rowIndex === currentIndex) return "active";
  return "pending";
}

const STAGE_LABELS: Record<VisibleStage, string> = {
  ingest: "Ingest /wp-converter/",
  crawl: "Crawl pages",
  parse: "Parse content",
  build: "Build WordPress package",
};

function StageIcon({ state }: { state: RowState }) {
  if (state === "done") {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-100 text-xs font-medium text-green-700">
        ✓
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className="flex h-5 w-5 items-center justify-center">
        <span className="h-3 w-3 animate-pulse rounded-full bg-gray-900" />
      </span>
    );
  }
  if (state === "error") {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-100 text-xs font-medium text-red-700">
        !
      </span>
    );
  }
  return (
    <span className="flex h-5 w-5 items-center justify-center">
      <span className="h-2 w-2 rounded-full border border-gray-300" />
    </span>
  );
}
