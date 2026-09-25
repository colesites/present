"use client";

import { useDashboard } from "../../components/DashboardShell";
import { SettingsSection } from "../../components/SettingsSection";

export default function SettingsPage() {
  const { currentOrg, isLoadingOrganizations } = useDashboard();
  return <SettingsSection currentOrg={currentOrg} isLoading={isLoadingOrganizations} />;
}
