import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { getJob } from "../db/job-store";
import { subscribeJob } from "../queue/events";

const EVENTS_PATH = /^\/api\/jobs\/([0-9a-f-]{36})\/events\/?(?:\?.*)?$/i;

interface SnapshotMessage {
  type: "snapshot";
  jobId: string;
  status: string;
  siteUrl: string;
  siteTitle: string;
  uscVersion: string;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
  downloadUrl: string | null;
}

export function attachJobEventsWss(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head) => {
    const match = req.url?.match(EVENTS_PATH);
    if (!match) {
      socket.destroy();
      return;
    }
    const jobId = match[1];
    wss.handleUpgrade(req, socket, head, (ws) => {
      void handleConnection(ws, jobId);
    });
  });

  return wss;
}

async function handleConnection(ws: WebSocket, jobId: string): Promise<void> {
  let job;
  try {
    job = await getJob(jobId);
  } catch (err) {
    closeWithError(ws, err instanceof Error ? err.message : "DB error");
    return;
  }
  if (!job) {
    closeWithError(ws, "Job not found");
    return;
  }

  const snapshot: SnapshotMessage = {
    type: "snapshot",
    jobId: job.id,
    status: job.status,
    siteUrl: job.input.siteUrl,
    siteTitle: job.input.siteTitle,
    uscVersion: job.input.uscVersion,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt ? job.completedAt.toISOString() : null,
    error: job.error,
    downloadUrl:
      job.status === "ready" ? `/api/jobs/${job.id}/export` : null,
  };
  ws.send(JSON.stringify(snapshot));

  if (job.status === "ready" || job.status === "failed") {
    ws.close(1000, "terminal");
    return;
  }

  const unsubscribe = subscribeJob(jobId, (update) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(update));
    if (update.status === "ready" || update.status === "failed") {
      ws.close(1000, "terminal");
    }
  });

  ws.on("close", () => unsubscribe());
  ws.on("error", () => unsubscribe());
}

function closeWithError(ws: WebSocket, message: string): void {
  try {
    ws.send(JSON.stringify({ type: "error", error: message }));
  } catch {
    // socket may already be closed
  }
  ws.close(1011, message.slice(0, 120));
}
