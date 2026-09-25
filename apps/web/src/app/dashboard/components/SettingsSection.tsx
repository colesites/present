"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Building2, ImagePlus, LogOut, ShieldCheck, Trash2, UsersRound } from "lucide-react";
import { api } from "../../../../../../packages/backend/convex/_generated/api";
import type { Id } from "../../../../../../packages/backend/convex/_generated/dataModel";
import {
  WORKSPACE_ROLES,
  WORKSPACE_TYPES,
  workspaceTypeLabel,
} from "../../../../../../packages/shared/src/workspace-roles";
import { useWorkspaceStore } from "../../../../../../packages/shared/src/store/workspace";
import type { DashboardOrganization } from "../types";
import { formatDate } from "./format";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  Eyebrow,
  Field,
  Notice,
  Page,
  PageHeader,
  Select,
  SkeletonRows,
  buttonClass,
  fieldClass,
  friendlyError,
} from "./ui";

const MAX_LOGO_BYTES = 1024 * 1024;

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/**
 * The workspace: its name, logo and kind, your role in it, and leaving it.
 * Admins change the workspace; everyone can set their own role.
 */
export function SettingsSection({
  currentOrg,
  isLoading,
}: {
  currentOrg: DashboardOrganization | null;
  isLoading: boolean;
}) {
  const { isAuthenticated } = useConvexAuth();
  const orgId = currentOrg?.id as Id<"organizations"> | undefined;
  const organization = useQuery(api.organizations.get, isAuthenticated && orgId ? { orgId } : "skip");

  return (
    <Page>
      <PageHeader
        eyebrow="Workspace"
        title="Settings"
        description={
          currentOrg
            ? `How ${currentOrg.name} appears to its team, and your place in it.`
            : "Settings for the workspace you're in."
        }
      />
      <div className="mt-8">
        {!currentOrg && !isLoading ? (
          <EmptyState
            icon={Building2}
            title="No organization selected"
            action={
              <Link href="/dashboard/organization/setup" className={buttonClass()}>
                Create or join one
              </Link>
            }
          >
            Settings belong to an organization. Create one, or accept an invitation to join.
          </EmptyState>
        ) : !organization ? (
          <SkeletonRows rows={3} height="h-[180px]" />
        ) : (
          <SettingsBody organization={organization} />
        )}
      </div>
    </Page>
  );
}

type Organization = NonNullable<FunctionReturnType<typeof api.organizations.get>>;

function SettingsBody({ organization }: { organization: Organization }) {
  const isAdmin = organization.me.role === "admin";
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-4">
        <GeneralCard organization={organization} isAdmin={isAdmin} />
        <YourRoleCard organization={organization} />
        <LeaveCard organization={organization} />
      </div>
      <div className="grid content-start gap-4">
        <Card>
          <span className="flex h-10 w-10 items-center justify-center rounded-control bg-primary/10 text-primary">
            <UsersRound className="h-5 w-5" />
          </span>
          <p className="mt-4 text-2xl font-semibold tracking-[-0.03em]">{organization.memberCount}</p>
          <p className="text-sm text-[#7d8798]">
            {organization.memberCount === 1 ? "person" : "people"}, {organization.adminCount}{" "}
            {organization.adminCount === 1 ? "admin" : "admins"}
          </p>
          <Link href="/dashboard/members" className={`${buttonClass("secondary", "sm")} mt-4 w-full`}>
            {isAdmin ? "Invite and manage" : "See members"}
          </Link>
        </Card>
        <Card tone="soft">
          <Eyebrow>Created</Eyebrow>
          <p className="mt-1.5 font-medium">{formatDate(organization.createdAt)}</p>
          <Eyebrow className="mt-4">You joined</Eyebrow>
          <p className="mt-1.5 font-medium">{formatDate(organization.me.joinedAt)}</p>
        </Card>
      </div>
    </div>
  );
}

function GeneralCard({ organization, isAdmin }: { organization: Organization; isAdmin: boolean }) {
  const update = useMutation(api.organizations.update);
  const [name, setName] = useState(organization.name);
  const [orgType, setOrgType] = useState(organization.orgType ?? "church");
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName(organization.name);
    setOrgType(organization.orgType ?? "church");
  }, [organization.name, organization.orgType]);

  const changed = name.trim() !== organization.name || orgType !== (organization.orgType ?? "church");

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      await update({ orgId: organization.id, name, orgType });
      setNotice({ kind: "ok", text: "Saved." });
    } catch (error) {
      setNotice({ kind: "error", text: friendlyError(error) });
    } finally {
      setSaving(false);
    }
  };

  const setLogo = async (file: File | null) => {
    setNotice(null);
    if (file && file.size > MAX_LOGO_BYTES) {
      setNotice({ kind: "error", text: "Use a logo under 1 MB." });
      return;
    }
    setLogoBusy(true);
    try {
      await update({ orgId: organization.id, logo: file ? await readAsDataUrl(file) : null });
    } catch (error) {
      setNotice({ kind: "error", text: friendlyError(error) });
    } finally {
      setLogoBusy(false);
    }
  };

  return (
    <Card>
      <form onSubmit={save}>
        <div className="flex flex-wrap items-center gap-4">
          <Avatar src={organization.logo} name={organization.name} size={64} shape="tile" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Logo</p>
            <p className="text-sm text-[#7d8798]">Shown in the app and on invitations. Square works best.</p>
          </div>
          {isAdmin ? (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" busy={logoBusy} onClick={() => fileRef.current?.click()}>
                <ImagePlus className="h-4 w-4" /> {organization.logo ? "Change" : "Upload"}
              </Button>
              {organization.logo ? (
                <Button size="sm" variant="ghost" disabled={logoBusy} onClick={() => void setLogo(null)} aria-label="Remove logo">
                  <Trash2 className="h-4 w-4" />
                </Button>
              ) : null}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) => {
                  void setLogo(event.target.files?.[0] ?? null);
                  event.target.value = "";
                }}
              />
            </div>
          ) : null}
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="org-name">
            <input
              id="org-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={!isAdmin}
              maxLength={80}
              className={fieldClass}
            />
          </Field>
          <Field label="Type" htmlFor="org-type">
            {isAdmin ? (
              <Select id="org-type" value={orgType} onChange={(event) => setOrgType(event.target.value)}>
                {WORKSPACE_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </Select>
            ) : (
              <input id="org-type" value={workspaceTypeLabel(organization.orgType)} disabled className={fieldClass} />
            )}
          </Field>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-h-[1.25rem]">
            {notice ? (
              <Notice kind={notice.kind}>{notice.text}</Notice>
            ) : !isAdmin ? (
              <p className="flex items-center gap-1.5 text-sm text-[#9aa3b2]">
                <ShieldCheck className="h-4 w-4" /> Only admins can change these.
              </p>
            ) : null}
          </div>
          {isAdmin ? (
            <Button type="submit" busy={saving} disabled={!changed || !name.trim()}>
              Save changes
            </Button>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

function YourRoleCard({ organization }: { organization: Organization }) {
  // Clerk's user id is the one Convex knows people by.
  const { user } = useUser();
  const updateMember = useMutation(api.users.updateMember);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const change = async (userRole: string) => {
    setError(null);
    setSaved(false);
    try {
      if (!user) return;
      await updateMember({ orgId: organization.id, userId: user.id, userRole });
      setSaved(true);
    } catch (failure) {
      setError(friendlyError(failure));
    }
  };

  return (
    <Card>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-semibold">Your role</p>
          <p className="mt-1 text-sm text-[#7d8798]">
            What you do here. Your team sees it on the Members page.
            {organization.me.role === "admin" ? " You're an admin of this workspace." : ""}
          </p>
        </div>
        <Select
          compact
          className="sm:w-52"
          value={organization.me.userRole}
          onChange={(event) => void change(event.target.value)}
          aria-label="Your role"
          disabled={!user}
        >
          {WORKSPACE_ROLES.map((role) => (
            <option key={role.value} value={role.value}>
              {role.label}
            </option>
          ))}
        </Select>
      </div>
      {error ? <div className="mt-3"><Notice kind="error">{error}</Notice></div> : null}
      {saved ? <p className="mt-3 text-sm text-emerald-600">Saved.</p> : null}
    </Card>
  );
}

function LeaveCard({ organization }: { organization: Organization }) {
  const router = useRouter();
  const leave = useMutation(api.organizations.leave);
  const setWorkspace = useWorkspaceStore((state) => state.setWorkspace);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onLeave = async () => {
    setBusy(true);
    setError(null);
    try {
      await leave({ orgId: organization.id });
      setWorkspace("personal", null);
      router.replace("/dashboard");
    } catch (failure) {
      setError(friendlyError(failure));
      setBusy(false);
    }
  };

  return (
    <Card className="border-red-100">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-semibold">Leave {organization.name}</p>
          <p className="mt-1 text-sm text-[#7d8798]">
            You lose access to its library and services. An admin can invite you back.
          </p>
        </div>
        {confirming ? (
          <div className="flex gap-2">
            <Button variant="danger" size="sm" busy={busy} onClick={() => void onLeave()}>
              Leave
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="danger-outline" size="sm" onClick={() => setConfirming(true)}>
            <LogOut className="h-4 w-4" /> Leave workspace
          </Button>
        )}
      </div>
      {error ? <div className="mt-3"><Notice kind="error">{error}</Notice></div> : null}
    </Card>
  );
}
