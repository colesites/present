"use client";

import { useDashboard } from "../../components/DashboardShell";
import { MembersSection } from "../../components/MembersSection";

export default function MembersPage() {
  const { currentOrg, isLoadingOrganizations } = useDashboard();
  return <MembersSection currentOrg={currentOrg} isLoading={isLoadingOrganizations} />;
}
