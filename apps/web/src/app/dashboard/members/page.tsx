import { DashboardClient } from "../DashboardClient";

export default function MembersPage() {
  return (
    <DashboardClient
      org={null}
      libraryItems={[]}
      shouldAutoOpen={false}
      section="members"
    />
  );
}
