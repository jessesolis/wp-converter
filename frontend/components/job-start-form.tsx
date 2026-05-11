"use client";

import { useState, type FormEvent } from "react";
import { USC_VERSIONS, type UscVersion } from "@/lib/usc-versions";

interface JobStartFormState {
  siteUrl: string;
  siteTitle: string;
  uscVersion: UscVersion | "";
}

interface IngestPage {
  path: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  canonical: string;
}

interface JobSuccessResponse {
  jobId: string;
  status: "ingest_complete";
  result: {
    siteUrl: string;
    pages: IngestPage[];
    contentZoneIds: string[];
  };
}

interface JobErrorResponse {
  error: string;
  jobId?: string;
  category?: string;
  retryable?: boolean;
}

const INITIAL_STATE: JobStartFormState = {
  siteUrl: "",
  siteTitle: "",
  uscVersion: "",
};

export function JobStartForm() {
  const [form, setForm] = useState<JobStartFormState>(INITIAL_STATE);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<JobSuccessResponse | null>(null);
  const [error, setError] = useState<JobErrorResponse | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form.uscVersion) return;
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = (await response.json()) as JobSuccessResponse | JobErrorResponse;
      if (!response.ok) {
        setError(body as JobErrorResponse);
      } else {
        setResult(body as JobSuccessResponse);
      }
    } catch (err) {
      setError({
        error:
          err instanceof Error ? err.message : "Network error reaching backend",
      });
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setForm(INITIAL_STATE);
    setResult(null);
    setError(null);
  }

  if (result) {
    return <IngestResultPanel result={result} onReset={reset} />;
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div>
        <label
          htmlFor="site-url"
          className="block text-sm font-medium text-gray-900"
        >
          Scorpion site URL
        </label>
        <input
          id="site-url"
          name="siteUrl"
          type="url"
          required
          placeholder="https://example.scorpionco.com"
          value={form.siteUrl}
          onChange={(e) => setForm({ ...form, siteUrl: e.target.value })}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
        />
        <p className="mt-1 text-xs text-gray-500">
          The live URL of the site to convert.
        </p>
      </div>

      <div>
        <label
          htmlFor="site-title"
          className="block text-sm font-medium text-gray-900"
        >
          Site title
        </label>
        <input
          id="site-title"
          name="siteTitle"
          type="text"
          required
          value={form.siteTitle}
          onChange={(e) => setForm({ ...form, siteTitle: e.target.value })}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
        />
        <p className="mt-1 text-xs text-gray-500">
          Used in the WordPress theme and metadata.
        </p>
      </div>

      <div>
        <label
          htmlFor="usc-version"
          className="block text-sm font-medium text-gray-900"
        >
          USC version
        </label>
        <select
          id="usc-version"
          name="uscVersion"
          required
          value={form.uscVersion}
          onChange={(e) =>
            setForm({
              ...form,
              uscVersion: e.target.value as UscVersion | "",
            })
          }
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
        >
          <option value="" disabled>
            Select a version…
          </option>
          {USC_VERSIONS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-gray-500">
          Pre-USC 3.0 frameworks are not supported by this tool.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-medium">Ingest failed</p>
          <p className="mt-1 text-red-700">{error.error}</p>
          {error.category && (
            <p className="mt-1 text-xs text-red-600">
              Category: <code>{error.category}</code>
              {error.retryable ? " (retryable)" : ""}
            </p>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex w-full items-center justify-center rounded-md bg-gray-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "Running ingest…" : "Start conversion"}
      </button>
    </form>
  );
}

function IngestResultPanel({
  result,
  onReset,
}: {
  result: JobSuccessResponse;
  onReset: () => void;
}) {
  const { jobId, result: data } = result;
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-green-700">
          Ingest complete
        </p>
        <p className="text-sm text-gray-600">
          Fetched <code className="text-gray-900">{data.siteUrl}/wp-converter/</code>{" "}
          and parsed both tables.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-4">
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
          <dt className="text-xs uppercase tracking-wider text-gray-500">
            Pages found
          </dt>
          <dd className="mt-1 text-2xl font-semibold text-gray-900">
            {data.pages.length}
          </dd>
        </div>
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
          <dt className="text-xs uppercase tracking-wider text-gray-500">
            Content zone IDs
          </dt>
          <dd className="mt-1 text-2xl font-semibold text-gray-900">
            {data.contentZoneIds.length}
          </dd>
        </div>
      </dl>

      {data.pages.length > 0 && (
        <section>
          <h3 className="text-sm font-medium text-gray-900">
            First {Math.min(data.pages.length, 10)} pages
          </h3>
          <ul className="mt-2 divide-y divide-gray-200 rounded-md border border-gray-200">
            {data.pages.slice(0, 10).map((p) => (
              <li key={p.canonical} className="px-3 py-2 text-sm">
                <p className="font-medium text-gray-900">{p.title || p.path}</p>
                <p className="truncate text-xs text-gray-500">{p.canonical}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.contentZoneIds.length > 0 && (
        <section>
          <h3 className="text-sm font-medium text-gray-900">
            Content zone IDs
          </h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {data.contentZoneIds.slice(0, 30).map((id) => (
              <span
                key={id}
                className="inline-flex items-center rounded bg-gray-100 px-2 py-0.5 text-xs font-mono text-gray-800"
              >
                {id}
              </span>
            ))}
            {data.contentZoneIds.length > 30 && (
              <span className="text-xs text-gray-500">
                +{data.contentZoneIds.length - 30} more
              </span>
            )}
          </div>
        </section>
      )}

      <p className="text-xs text-gray-400">
        Job ID: <code>{jobId}</code>
      </p>

      <button
        type="button"
        onClick={onReset}
        className="inline-flex w-full items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-900 shadow-sm transition hover:bg-gray-50"
      >
        Start another
      </button>
    </div>
  );
}
