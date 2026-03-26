import { DashboardClient } from "./DashboardClient";

interface DashboardPageProps {
  searchParams: Promise<{
    setup?: string;
  }>;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const resolvedSearchParams = await searchParams;

  return (
    <DashboardClient
      org={null}
      libraryItems={[]}
      shouldAutoOpen={resolvedSearchParams.setup === "1"}
      section="dashboard"
    />
  );
}
