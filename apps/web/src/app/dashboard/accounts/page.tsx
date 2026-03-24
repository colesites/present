import { DashboardClient } from "../DashboardClient";

export default function AccountsPage() {
  return (
    <DashboardClient
      org={null}
      songs={[]}
      shouldAutoOpen={false}
      section="accounts"
    />
  );
}
