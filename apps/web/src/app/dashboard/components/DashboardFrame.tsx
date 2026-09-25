"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Menu, X } from "lucide-react";
import type { DashboardOrganization, DashboardSection } from "../types";
import { navItems } from "./DashboardSidebar";
import { Avatar, cx } from "./ui";

/**
 * The dashboard's layout at every size.
 *
 * From 1024px the navigation sits beside a white panel that scrolls on its
 * own. Below that, the page takes the whole width under a bar with a menu
 * button, and the navigation slides in over it.
 */
export function DashboardFrame({
  section,
  currentOrg,
  sidebar,
  children,
}: {
  section: DashboardSection;
  currentOrg: DashboardOrganization | null;
  /** The navigation; `onNavigate` closes the phone menu when a link is followed. */
  sidebar: (onNavigate?: () => void) => ReactNode;
  children: ReactNode;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // The phone menu closes with Escape, and the page behind it holds still.
  useEffect(() => {
    if (!isMenuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMenuOpen(false);
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [isMenuOpen]);

  return (
    <div className="min-h-dvh bg-[#111111] lg:h-dvh lg:overflow-hidden">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-white/[0.06] bg-[#111111]/95 px-3 backdrop-blur sm:px-4 lg:hidden">
        <button
          type="button"
          onClick={() => setIsMenuOpen(true)}
          aria-label="Open menu"
          aria-expanded={isMenuOpen}
          className="flex h-10 w-10 flex-none items-center justify-center rounded-full text-white transition hover:bg-white/10"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Avatar src={currentOrg?.logo} name={currentOrg?.name ?? "Present"} size={30} shape="tile" />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{currentOrg?.name ?? "Present"}</p>
        <p className="flex-none text-sm text-white/50">{navItems.find((item) => item.section === section)?.label}</p>
      </header>

      <div
        className={cx("fixed inset-0 z-50 lg:hidden", isMenuOpen ? "visible" : "invisible")}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
      >
        <button
          type="button"
          tabIndex={-1}
          aria-label="Close menu"
          onClick={() => setIsMenuOpen(false)}
          className={cx(
            "absolute inset-0 bg-black/60 transition-opacity duration-200",
            isMenuOpen ? "opacity-100" : "opacity-0",
          )}
        />
        <div
          className={cx(
            "absolute inset-y-0 left-0 flex w-[min(86vw,320px)] flex-col bg-[#111111] px-3 pb-4 pt-14 shadow-2xl transition-transform duration-200",
            isMenuOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <button
            type="button"
            onClick={() => setIsMenuOpen(false)}
            aria-label="Close menu"
            className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
          {isMenuOpen ? sidebar(() => setIsMenuOpen(false)) : null}
        </div>
      </div>

      <div className="lg:mx-auto lg:flex lg:h-full lg:max-w-[1680px] lg:gap-5 lg:p-4 xl:gap-6 xl:p-5">
        <aside className="hidden flex-none py-3 pl-1 lg:block lg:w-[240px] xl:w-[268px]">{sidebar()}</aside>
        <main className="min-h-[calc(100dvh-3.5rem)] rounded-t-panel bg-white lg:min-h-0 lg:min-w-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain lg:rounded-panel lg:[scrollbar-gutter:stable]">
          {children}
        </main>
      </div>
    </div>
  );
}
