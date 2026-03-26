import { DashboardClient } from "../DashboardClient";

export default function AccountsPage() {
  return (
    <DashboardClient
      org={null}
      libraryItems={[]}
      shouldAutoOpen={false}
      section="accounts"
    />
  );
}
