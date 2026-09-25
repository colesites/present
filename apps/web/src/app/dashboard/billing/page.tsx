import { DashboardClient } from "../DashboardClient";

export default function BillingPage() {
  return (
    <DashboardClient
      org={null}
      libraryItems={[]}
      shouldAutoOpen={false}
      section="billing"
    />
  );
}
