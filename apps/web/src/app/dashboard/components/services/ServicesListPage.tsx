"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "convex/react";
import { ChevronRight, Plus, Search } from "lucide-react";
import { api } from "../../../../../../../packages/backend/convex/_generated/api";
import type { DashboardServiceItem } from "../../types";
import { useDashboard } from "../DashboardShell";
import { formatDate, parseServiceDate } from "../format";
import { orderedEntries } from "../service-order";
import { Button, Dialog, EmptyState, Field, List, Notice, Page, PageHeader, Select, SkeletonRows, cx, fieldClass, friendlyError } from "../ui";

/** The coming Sunday, as "YYYY-MM-DD", for a new service's date. */
const nextSunday = () => {
  const date = new Date();
  date.setDate(date.getDate() + ((7 - date.getDay()) % 7 || 7));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

/** In the order the desktop app lists them: the operator's own order. */
const byDesktopOrder = (a: DashboardServiceItem, b: DashboardServiceItem) =>
  (a.order ?? 0) - (b.order ?? 0) || a.createdAt - b.createdAt;

export function ServicesListPage() {
  const { services, workspaceId } = useDashboard();
  const [view, setView] = useState<"active" | "archived">("active");
  const [query, setQuery] = useState("");
  // `?new=1` comes from "New service" elsewhere in the dashboard.
  const params = useSearchParams();
  const [creating, setCreating] = useState(() => params.get("new") === "1");
  const closeCreating = () => {
    setCreating(false);
    if (params.get("new")) window.history.replaceState(null, "", window.location.pathname);
  };

  const counts = useMemo(
    () => ({
      active: services?.filter((service) => !service.archivedAt).length ?? 0,
      archived: services?.filter((service) => service.archivedAt).length ?? 0,
    }),
    [services],
  );

  const visible = useMemo(() => {
    if (!services) return null;
    const needle = query.trim().toLowerCase();
    return services
      .filter((service) => (view === "archived" ? Boolean(service.archivedAt) : !service.archivedAt))
      .filter((service) => !needle || service.name.toLowerCase().includes(needle))
      .sort(byDesktopOrder);
  }, [query, services, view]);

  return (
    <Page wide>
      <PageHeader
        title="Services"
        description="In the same order as the desktop app. Changes made here reach everyone's app."
        actions={
          <Button onClick={() => setCreating(true)} disabled={!workspaceId}>
            <Plus className="h-4 w-4" /> New service
          </Button>
        }
      />

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1" role="tablist" aria-label="Services">
          {(["active", "archived"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={view === option}
              onClick={() => setView(option)}
              className={cx(
                "h-8 rounded-[8px] px-3 text-sm transition-colors",
                view === option ? "bg-[#f1f2f6] font-medium text-[#1d2240]" : "text-[#6b7285] hover:text-[#1d2240]",
              )}
            >
              {option === "active" ? "Active" : "Archived"}
              <span className="ml-1.5 text-[#9aa1b1]">{counts[option]}</span>
            </button>
          ))}
        </div>
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa1b1]" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search services"
            aria-label="Search services"
            className={cx(fieldClass, "pl-9")}
          />
        </div>
      </div>

      <div className="mt-4">
        {!visible ? (
          <SkeletonRows rows={5} />
        ) : visible.length === 0 ? (
          <EmptyState
            title={query ? "No services match" : view === "archived" ? "Nothing archived" : "No services yet"}
            action={
              !query && view === "active" ? (
                <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
                  Plan a service
                </Button>
              ) : null
            }
          >
            {query ? "Try another name." : view === "archived" ? "Services you archive in the app or here are kept here." : "Plan one here or in the desktop app."}
          </EmptyState>
        ) : (
          <List>
            {visible.map((service) => {
              const date = parseServiceDate(service.date);
              const count = orderedEntries(service).length;
              return (
                <li key={service._id}>
                  <Link
                    href={`/dashboard/services/${service._id}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 px-4 py-3 transition hover:bg-[#fafbfc] sm:grid-cols-[minmax(0,1fr)_9rem_5rem_1rem]"
                  >
                    <span className="truncate font-medium">{service.name}</span>
                    <span className="row-start-2 truncate text-sm text-[#9aa1b1] sm:row-start-auto sm:text-[#6b7285]">
                      {date ? formatDate(date, { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "No date"}
                    </span>
                    <span className="row-span-2 text-right text-sm tabular-nums text-[#9aa1b1] sm:row-span-1">
                      {count} {count === 1 ? "item" : "items"}
                    </span>
                    <ChevronRight className="hidden h-4 w-4 text-[#c3c8d3] sm:block" />
                  </Link>
                </li>
              );
            })}
          </List>
        )}
      </div>

      <NewServiceDialog open={creating} onClose={closeCreating} services={services ?? []} />
    </Page>
  );
}

export function NewServiceDialog({
  open,
  onClose,
  services,
  copyFrom,
}: {
  open: boolean;
  onClose: () => void;
  services: DashboardServiceItem[];
  /** Start with this service's running order selected. */
  copyFrom?: string;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New service"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="new-service">
            Create service
          </Button>
        </>
      }
    >
      {/* Mounted per opening, so each one starts from fresh defaults. */}
      {open ? <NewServiceForm onDone={onClose} services={services} copyFrom={copyFrom} /> : null}
    </Dialog>
  );
}

function NewServiceForm({
  onDone,
  services,
  copyFrom,
}: {
  onDone: () => void;
  services: DashboardServiceItem[];
  copyFrom?: string;
}) {
  const router = useRouter();
  const { workspaceId } = useDashboard();
  const create = useMutation(api.services.create);
  const duplicate = useMutation(api.services.duplicate);
  const [name, setName] = useState(() =>
    copyFrom ? `${services.find((service) => service._id === copyFrom)?.name ?? "Service"} (copy)` : "Sunday Service",
  );
  const [date, setDate] = useState(nextSunday);
  const [source, setSource] = useState(copyFrom ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recent = useMemo(() => [...services].filter((service) => !service.archivedAt).sort(byDesktopOrder).reverse().slice(0, 12), [services]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!workspaceId || !name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const id = source
        ? await duplicate({ workspaceId, serviceId: source, name: name.trim(), date: date || undefined })
        : await create({ workspaceId, name: name.trim(), date: date || undefined });
      onDone();
      router.push(`/dashboard/services/${id}`);
    } catch (failure) {
      setError(friendlyError(failure));
      setBusy(false);
    }
  };

  return (
    <form id="new-service" onSubmit={submit} className="space-y-4">
      <Field label="Name" htmlFor="service-name">
        <input id="service-name" value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} autoFocus required />
      </Field>
      <Field label="Date" htmlFor="service-date" hint="Leave empty if it doesn't have one yet.">
        <input id="service-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} className={fieldClass} />
      </Field>
      {recent.length > 0 ? (
        <Field label="Start from" htmlFor="service-source">
          <Select id="service-source" value={source} onChange={(event) => setSource(event.target.value)}>
            <option value="">An empty service</option>
            {recent.map((service) => (
              <option key={service._id} value={service._id}>
                Copy of {service.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {busy ? <p className="text-sm text-[#6b7285]">Creating…</p> : null}
      {error ? <Notice kind="error">{error}</Notice> : null}
    </form>
  );
}
