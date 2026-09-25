"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useClerk, useUser } from "@clerk/nextjs";
import { useMutation, useQuery, useConvexAuth } from "convex/react";
import { Camera, Check, LogOut, Mail, Plus } from "lucide-react";
import { api } from "../../../../../../packages/backend/convex/_generated/api";
import { workspaceRoleLabel } from "../../../../../../packages/shared/src/workspace-roles";
import type { DashboardOrganizationListItem } from "../types";
import { PlanUsageCard, useBillingStatus } from "./usage";
import {
  Avatar,
  Button,
  Card,
  Field,
  Notice,
  Page,
  PageHeader,
  SectionTitle,
  buttonClass,
  fieldClass,
  friendlyError,
} from "./ui";

/**
 * You: your name and photo, how you sign in, your plan, the workspaces you
 * are in and the invitations waiting for you. The workspace itself is
 * Settings.
 */
export function AccountSection({
  organizations,
  onSignOut,
  isSigningOut,
}: {
  organizations: DashboardOrganizationListItem[];
  onSignOut: () => void;
  isSigningOut: boolean;
}) {
  const { user, isLoaded } = useUser();
  const clerk = useClerk();
  const billing = useBillingStatus();

  return (
    <Page>
      <PageHeader
        title="Account"
        description="Your profile, how you sign in, and the workspaces you belong to."
        actions={
          <Button variant="outline" onClick={onSignOut} busy={isSigningOut}>
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        }
      />

      <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          {isLoaded && user ? <ProfileCard /> : <div className="h-[260px] animate-pulse rounded-card bg-[#f1f2f6]" />}

          <Card>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-semibold">Sign-in and security</p>
                <p className="mt-1 text-sm leading-6 text-[#6b7285]">
                  Email addresses, password, two-step verification and connected Google accounts.
                </p>
              </div>
              <Button variant="outline" onClick={() => clerk.openUserProfile()}>
                Manage
              </Button>
            </div>
          </Card>

          <InvitationsCard />
          <OrganizationsCard organizations={organizations} />
        </div>

        <div className="grid content-start gap-4">
          <PlanUsageCard status={billing} />
        </div>
      </div>
    </Page>
  );
}

function ProfileCard() {
  const { user } = useUser();
  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setFirstName(user?.firstName ?? "");
    setLastName(user?.lastName ?? "");
  }, [user?.firstName, user?.lastName]);

  if (!user) return null;
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || "You";
  const changed = firstName.trim() !== (user.firstName ?? "") || lastName.trim() !== (user.lastName ?? "");

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      await user.update({ firstName: firstName.trim(), lastName: lastName.trim() });
      setNotice({ kind: "ok", text: "Saved." });
    } catch {
      setNotice({ kind: "error", text: "Your name couldn't be saved. Try again." });
    } finally {
      setSaving(false);
    }
  };

  const changePhoto = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setNotice({ kind: "error", text: "Use a photo under 5 MB." });
      return;
    }
    setUploading(true);
    setNotice(null);
    try {
      await user.setProfileImage({ file });
    } catch {
      setNotice({ kind: "error", text: "That photo couldn't be used. Try another." });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card>
      <form onSubmit={save}>
        <div className="flex items-center gap-4">
          <div className="relative flex-none">
            <Avatar src={user.imageUrl} name={name} size={64} />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              aria-label="Change photo"
              className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-[#232946] text-white transition hover:bg-primary disabled:opacity-60"
            >
              <Camera className="h-3.5 w-3.5" />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                void changePhoto(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </div>
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">{name}</p>
            <p className="flex items-center gap-1.5 truncate text-sm text-[#6b7285]">
              <Mail className="h-3.5 w-3.5 flex-none" />
              <span className="truncate">{user.primaryEmailAddress?.emailAddress}</span>
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Field label="First name" htmlFor="first-name">
            <input id="first-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} className={fieldClass} autoComplete="given-name" />
          </Field>
          <Field label="Last name" htmlFor="last-name">
            <input id="last-name" value={lastName} onChange={(event) => setLastName(event.target.value)} className={fieldClass} autoComplete="family-name" />
          </Field>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-h-[1.25rem]">{notice ? <Notice kind={notice.kind}>{notice.text}</Notice> : null}</div>
          <Button type="submit" busy={saving} disabled={!changed}>
            Save changes
          </Button>
        </div>
      </form>
    </Card>
  );
}

function InvitationsCard() {
  const { isAuthenticated } = useConvexAuth();
  const invitations = useQuery(api.invites.listMine, isAuthenticated ? {} : "skip");
  const accept = useMutation(api.invites.accept);
  const decline = useMutation(api.invites.decline);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!invitations || invitations.length === 0) return null;

  const respond = async (token: string, action: "accept" | "decline") => {
    setBusy(token);
    setError(null);
    try {
      if (action === "accept") await accept({ token });
      else await decline({ token });
    } catch (failure) {
      setError(friendlyError(failure));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <h2 className="font-semibold">Invitations</h2>
      <ul className="mt-3 divide-y divide-[#eff0f4]">
        {invitations.map((invitation) => (
          <li key={invitation.id} className="flex flex-col gap-3 py-3 first:pt-1 last:pb-0 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Avatar src={invitation.orgLogo} name={invitation.orgName} size={40} shape="tile" />
              <div className="min-w-0">
                <p className="truncate font-medium">{invitation.orgName}</p>
                <p className="truncate text-sm text-[#9aa1b1]">
                  {invitation.invitedByName ? `From ${invitation.invitedByName}` : "Invitation"}
                  {invitation.userRole ? ` · ${workspaceRoleLabel(invitation.userRole)}` : ""}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" busy={busy === invitation.token} onClick={() => void respond(invitation.token, "accept")}>
                <Check className="h-4 w-4" /> Join
              </Button>
              <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void respond(invitation.token, "decline")}>
                Decline
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {error ? <div className="mt-3"><Notice kind="error">{error}</Notice></div> : null}
    </Card>
  );
}

function OrganizationsCard({ organizations }: { organizations: DashboardOrganizationListItem[] }) {
  const { isAuthenticated } = useConvexAuth();
  const mine = useQuery(api.users.listMyOrganizations, isAuthenticated ? {} : "skip") as
    | Array<{ id: string; role: string }>
    | undefined;
  const roleOf = new Map((mine ?? []).map((org) => [org.id, org.role]));

  return (
    <Card>
      <SectionTitle
        aside={
          <Link href="/dashboard/organization/setup" className={buttonClass("outline", "sm")}>
            <Plus className="h-4 w-4" /> New or join
          </Link>
        }
      >
        Your organizations
      </SectionTitle>
      {organizations.length === 0 ? (
        <p className="mt-4 text-sm text-[#6b7285]">You aren&apos;t in an organization yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-[#f0f1f5]">
          {organizations.map((organization) => (
            <li key={organization.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <Avatar src={organization.logo} name={organization.name} size={36} shape="tile" />
              <p className="min-w-0 flex-1 truncate font-medium">{organization.name}</p>
              <span className="flex-none text-sm text-[#6b7285]">
                {roleOf.get(organization.id) === "admin" ? "Admin" : "Member"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
