import { DashboardClient } from "../DashboardClient";

export default function SettingsPage() {
  return (
    <DashboardClient
      org={null}
      libraryItems={[]}
      shouldAutoOpen={false}
      section="settings"
    />
  );
}
