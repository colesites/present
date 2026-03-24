import { DashboardClient } from "../DashboardClient";

export default function SettingsPage() {
  return (
    <DashboardClient
      org={null}
      songs={[]}
      shouldAutoOpen={false}
      section="settings"
    />
  );
}
