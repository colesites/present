"use client";

import { useDashboard } from "../../components/DashboardShell";
import { LibrarySection } from "../../components/LibrarySection";

export default function LibraryPage() {
  const { currentOrg, libraryItems } = useDashboard();
  return <LibrarySection currentOrg={currentOrg} libraryItems={libraryItems} />;
}
