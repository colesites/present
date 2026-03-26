import { DashboardClient } from "../DashboardClient";

export default function LibraryPage() {
  return (
    <DashboardClient
      org={null}
      libraryItems={[]}
      shouldAutoOpen={false}
      section="library"
    />
  );
}
