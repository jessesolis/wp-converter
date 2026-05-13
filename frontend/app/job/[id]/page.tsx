import { JobProgress } from "./job-progress";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function JobProgressPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <JobProgress jobId={id} />
    </main>
  );
}
