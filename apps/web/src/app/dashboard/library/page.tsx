import { DashboardClient } from "../DashboardClient";

export default function LibraryPage() {
  return (
    <DashboardClient
      org={null}
      songs={[]}
      shouldAutoOpen={false}
      section="library"
    />
  );
}
