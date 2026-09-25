import { OverviewPage } from "../components/OverviewPage";

interface DashboardPageProps {
  searchParams: Promise<{ setup?: string }>;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const { setup } = await searchParams;
  return <OverviewPage shouldAutoOpen={setup === "1"} />;
}
