import { DashboardClient } from "../DashboardClient";

export default function BiblePage() {
  return (
    <DashboardClient
      org={null}
      libraryItems={[]}
      shouldAutoOpen={false}
      section="bible"
    />
  );
}
