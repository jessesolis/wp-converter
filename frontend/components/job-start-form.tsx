"use client";

import { useState, type FormEvent } from "react";
import { USC_VERSIONS, type UscVersion } from "@/lib/usc-versions";

interface JobStartFormState {
  siteUrl: string;
  siteTitle: string;
  uscVersion: UscVersion | "";
}

const INITIAL_STATE: JobStartFormState = {
  siteUrl: "",
  siteTitle: "",
  uscVersion: "",
};

export function JobStartForm() {
  const [form, setForm] = useState<JobStartFormState>(INITIAL_STATE);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form.uscVersion) return;
    setSubmitting(true);
    // TODO: POST to backend job-creation endpoint once it exists, then
    // router.push(`/job/${createdJobId}`). For now this is a stub.
    console.log("Job start payload:", form);
    setSubmitting(false);
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

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex w-full items-center justify-center rounded-md bg-gray-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "Starting…" : "Start conversion"}
      </button>
    </form>
  );
}
