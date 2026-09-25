import type { ReactNode } from "react";
import { DashboardShell } from "../components/DashboardShell";

/**
 * Every dashboard page but organization setup, inside one shell that stays
 * mounted as people move between them.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
