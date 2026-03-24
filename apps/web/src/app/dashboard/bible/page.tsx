import { DashboardClient } from "../DashboardClient";

export default function BiblePage() {
  return (
    <DashboardClient
      org={null}
      songs={[]}
      shouldAutoOpen={false}
      section="bible"
    />
  );
}
