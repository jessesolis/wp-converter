"use client";

import { useEffect, useRef, useState } from "react";

type JobStatus =
  | "queued"
  | "framework_check"
  | "ingest"
  | "crawl"
  | "parse"
  | "download"
  | "build"
  | "ready"
  | "failed";

interface JobView {
  jobId: string;
  status: JobStatus;
  siteUrl: string;
  siteTitle: string;
  uscVersion: string;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
  downloadUrl: string | null;
}

interface SnapshotMessage extends JobView {
  type: "snapshot";
}

interface UpdateMessage {
  type: "update";
  jobId: string;
  status: JobStatus;
  error: string | null;
  downloadUrl: string | null;
  completedAt: string | null;
}

interface ErrorMessage {
  type: "error";
  error: string;
}

type WsMessage = SnapshotMessage | UpdateMessage | ErrorMessage;

const VISIBLE_STAGES = ["ingest", "crawl", "parse", "build"] as const;
type VisibleStage = (typeof VISIBLE_STAGES)[number];

function isTerminal(status: JobStatus): boolean {
  return status === "ready" || status === "failed";
}

export function JobProgress({ jobId }: { jobId: string }) {
  const [view, setView] = useState<JobView | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;
    let usedPollingFallback = false;

    const wsBase =
      process.env.NEXT_PUBLIC_BACKEND_WS_URL ?? "ws://localhost:3001";
    const wsUrl = `${wsBase}/api/jobs/${jobId}/events`;

    const cleanup = () => {
      cancelled = true;
      if (pollTimer.current) {
        clearTimeout(pollTimer.current);
        pollTimer.current = null;
      }
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        if (
          ws.readyState === WebSocket.OPEN ||
          ws.readyState === WebSocket.CONNECTING
        ) {
          ws.close();
        }
        ws = null;
      }
    };

    async function pollOnce() {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          if (!cancelled) setFetchError(body.error ?? `HTTP ${res.status}`);
          return;
        }
        const body = (await res.json()) as JobView;
        if (cancelled) return;
        setView(body);
        setFetchError(null);
        if (!isTerminal(body.status)) {
          pollTimer.current = setTimeout(pollOnce, 1500);
        }
      } catch (err) {
        if (!cancelled) {
          setFetchError(err instanceof Error ? err.message : "Network error");
          pollTimer.current = setTimeout(pollOnce, 2500);
        }
      }
    }

    function fallbackToPolling(reason: string) {
      if (usedPollingFallback || cancelled) return;
      usedPollingFallback = true;
      console.warn(`[job-progress] WebSocket fallback: ${reason}`);
      pollOnce();
    }

    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      fallbackToPolling(
        err instanceof Error ? err.message : "WebSocket constructor threw",
      );
      return cleanup;
    }

    ws.onmessage = (event) => {
      if (cancelled) return;
      let msg: WsMessage;
      try {
        msg = JSON.parse(event.data) as WsMessage;
      } catch {
        return;
      }
      if (msg.type === "error") {
        setFetchError(msg.error);
        return;
      }
      if (msg.type === "snapshot") {
        setView(msg);
        setFetchError(null);
        return;
      }
      // update
      setView((prev) =>
        prev
          ? {
              ...prev,
              status: msg.status,
              error: msg.error,
              downloadUrl: msg.downloadUrl,
              completedAt: msg.completedAt,
            }
          : prev,
      );
    };

    ws.onerror = () => {
      // onclose fires after onerror — let it decide whether to fall back.
    };

    ws.onclose = (event) => {
      if (cancelled) return;
      // 1000 = normal closure (the server hit a terminal status).
      // Anything else is unexpected — drop to polling so the UI keeps moving.
      if (event.code !== 1000) {
        fallbackToPolling(`ws closed code=${event.code}`);
      }
    };

    return cleanup;
  }, [jobId]);

  if (!view) {
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
          {view.status === "ready"
            ? "Conversion complete"
            : view.status === "failed"
              ? "Conversion failed"
              : "Conversion in progress"}
        </p>
        <h1 className="text-xl font-semibold text-gray-900">
          {view.siteTitle}
        </h1>
        <p className="truncate text-sm text-gray-500">{view.siteUrl}</p>
      </header>

      <StageList status={view.status} />

      {view.status === "ready" && view.downloadUrl && (
        <a
          href={view.downloadUrl}
          className="block rounded-md border border-gray-900 bg-gray-900 px-4 py-3 text-center text-sm font-medium text-white shadow-sm transition hover:bg-gray-800"
        >
          Download WordPress package
        </a>
      )}

      {view.status === "failed" && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-medium">Conversion failed</p>
          <p className="mt-1 text-red-700">
            {view.error ?? "Unknown error"}
          </p>
        </div>
      )}

      {fetchError && view.status !== "ready" && view.status !== "failed" && (
        <p className="text-xs text-amber-700">{fetchError}</p>
      )}

      <p className="text-xs text-gray-400">
        Job ID: <code>{view.jobId}</code>
      </p>
    </div>
  );
}

function StageList({ status }: { status: JobStatus }) {
  const currentIndex = stageIndex(status);
  return (
    <ol className="space-y-2">
      {VISIBLE_STAGES.map((stage, i) => {
        const rowState = stageRowState(i, currentIndex, status);
        return (
          <li
            key={stage}
            className="flex items-center gap-3 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
          >
            <StageIcon state={rowState} />
            <span
              className={
                rowState === "pending"
                  ? "text-gray-400"
                  : rowState === "active"
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

function stageIndex(status: JobStatus): number {
  if (status === "queued" || status === "framework_check") return -1;
  if (status === "ready") return VISIBLE_STAGES.length;
  if (status === "failed") return -2;
  if (status === "download") return VISIBLE_STAGES.indexOf("build");
  const idx = VISIBLE_STAGES.indexOf(status as VisibleStage);
  return idx >= 0 ? idx : -1;
}

type RowState = "done" | "active" | "pending" | "error";

function stageRowState(
  rowIndex: number,
  currentIndex: number,
  status: JobStatus,
): RowState {
  if (status === "failed") {
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
