export class IngestError extends Error {
  constructor(
    message: string,
    public readonly siteUrl: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "IngestError";
  }
}

export type IngestFetchCategory =
  | "network"
  | "not_found"
  | "client_error"
  | "server_error"
  | "unexpected";

export class IngestFetchError extends IngestError {
  public readonly category: IngestFetchCategory;
  public readonly retryable: boolean;

  constructor(
    siteUrl: string,
    public readonly status: number | null,
    cause?: unknown,
  ) {
    const category = categorizeFetchStatus(status);
    super(
      `Failed to fetch /wp-converter/ from ${siteUrl}: ${describeFetchStatus(status)}`,
      siteUrl,
      cause,
    );
    this.name = "IngestFetchError";
    this.category = category;
    this.retryable = category === "network" || category === "server_error";
  }
}

function categorizeFetchStatus(status: number | null): IngestFetchCategory {
  if (status === null) return "network";
  if (status === 404) return "not_found";
  if (status >= 500 && status < 600) return "server_error";
  if (status >= 400 && status < 500) return "client_error";
  return "unexpected";
}

function describeFetchStatus(status: number | null): string {
  if (status === null) return "network error";
  if (status === 404) return "HTTP 404 — /wp-converter/ endpoint not found";
  return `HTTP ${status}`;
}

export class IngestParseError extends IngestError {
  constructor(siteUrl: string, message: string) {
    super(message, siteUrl);
    this.name = "IngestParseError";
  }
}
