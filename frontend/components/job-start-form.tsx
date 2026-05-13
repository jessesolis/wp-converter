"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { USC_VERSIONS, type UscVersion } from "@/lib/usc-versions";

interface JobStartFormState {
  siteUrl: string;
  siteTitle: string;
  uscVersion: UscVersion | "";
}

interface JobEnqueuedResponse {
  jobId: string;
  status: string;
}

interface JobErrorResponse {
  error: string;
  category?: string;
  retryable?: boolean;
}

const INITIAL_STATE: JobStartFormState = {
  siteUrl: "",
  siteTitle: "",
  uscVersion: "",
};

export function JobStartForm() {
  const router = useRouter();
  const [form, setForm] = useState<JobStartFormState>(INITIAL_STATE);
  const [submitting, setSubmitting] = useState(false);
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
      const body = (await response.json()) as
        | JobEnqueuedResponse
        | JobErrorResponse;
      if (!response.ok) {
        setError(body as JobErrorResponse);
        setSubmitting(false);
        return;
      }
      const { jobId } = body as JobEnqueuedResponse;
      router.push(`/job/${jobId}`);
    } catch (err) {
      setError({
        error:
          err instanceof Error ? err.message : "Network error reaching backend",
      });
      setSubmitting(false);
    }
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
          <p className="font-medium">Could not start conversion</p>
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
        {submitting ? "Queuing conversion…" : "Start conversion"}
      </button>
    </form>
  );
}
