import { JobStartForm } from "@/components/job-start-form";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-16">
        <header className="mb-8">
          <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
            Scorpion → WordPress
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-gray-900">
            Start a conversion
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            Enter the live Scorpion site you want to convert. The tool will
            crawl every page, extract stylesheets, JavaScript, media, and
            content zones, then assemble a WordPress export package.
          </p>
        </header>
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <JobStartForm />
        </div>
      </div>
    </main>
  );
}
