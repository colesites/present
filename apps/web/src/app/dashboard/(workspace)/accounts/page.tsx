"use client";

import { useDashboard } from "../../components/DashboardShell";
import { AccountSection } from "../../components/AccountSection";

export default function AccountPage() {
  const { organizations, signOut, isSigningOut } = useDashboard();
  return <AccountSection organizations={organizations} onSignOut={signOut} isSigningOut={isSigningOut} />;
}
