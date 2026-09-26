"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { Check, Copy, Mail, MoreHorizontal, ShieldCheck, X } from "lucide-react";

import { api } from "../../../../../../packages/backend/convex/_generated/api";
import type { Id } from "../../../../../../packages/backend/convex/_generated/dataModel";
import {
  WORKSPACE_ROLES,
  defaultAccessFor,
  normalizeWorkspaceRole,
  workspaceRoleLabel,
  type WorkspaceRole,
} from "../../../../../../packages/shared/src/workspace-roles";
import type { DashboardOrganization } from "../types";
import { useMembers, type WorkspaceMember as Member } from "./use-members";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  Notice,
  Page,
  PageHeader,
  SectionTitle,
  Select,
  SkeletonRows,
  Toggle,
  buttonClass,
  cx,
  fieldClass,
  friendlyError,
} from "./ui";


const expiresIn = (at: number) => {
  const days = Math.max(0, Math.ceil((at - Date.now()) / 86_400_000));
  return days <= 1 ? "expires today" : `expires in ${days} days`;
};

/**
 * Who is in the workspace, who is invited, and room for one more.
 *
 * Everyone sees the members and can set their own role. Admins invite,
 * revoke, remove, and change anyone's role or admin access. Invitations
 * are accepted by the person invited, on the website or in the desktop app
 * (`convex/invites.ts`).
 */
export function MembersSection({
  currentOrg,
  isLoading,
}: {
  currentOrg: DashboardOrganization | null;
  /** The workspaces are still loading, so no organization is known yet. */
  isLoading: boolean;
}) {
  const orgId = currentOrg?.id as Id<"organizations"> | undefined;
  const invitations = useQuery(api.invites.listForWorkspace, orgId ? { orgId } : "skip");
  const revokeInvite = useMutation(api.invites.revoke);
  const removeMember = useMutation(api.users.removeUserFromOrganization);
  const updateMember = useMutation(api.users.updateMember);

  const { members, error: membersError, reload: loadMembers } = useMembers(orgId);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const isAdmin = invitations !== null && invitations !== undefined;

  const copy = async (url: string, id: string) => {
    await navigator.clipboard.writeText(url).catch(() => undefined);
    setCopied(id);
    window.setTimeout(() => setCopied((current) => (current === id ? null : current)), 1600);
  };

  /** Change a member, then show the list as the server now has it. */
  const change = async (run: () => Promise<unknown>, success?: string) => {
    setNotice(null);
    try {
      await run();
      await loadMembers();
      if (success) setNotice({ kind: "ok", text: success });
    } catch (error) {
      setNotice({ kind: "error", text: friendlyError(error) });
    }
  };

  if (!currentOrg) {
    return (
      <Page>
        <PageHeader title="Members" description="The people you present with." />
        <div className="mt-8">
          {isLoading ? (
            <SkeletonRows rows={3} />
          ) : (
            <EmptyState
              title="Members belong to an organization"
              action={
                <Link href="/dashboard/organization/setup" className={buttonClass()}>
                  Create an organization
                </Link>
              }
            >
              Your personal workspace is just you. Create an organization, or switch to one, to invite your team.
            </EmptyState>
          )}
        </div>
      </Page>
    );
  }

  const workspaceId = currentOrg.id as Id<"organizations">;
  const seats = invitations?.seats;
  const full = seats ? seats.members + seats.pendingInvites >= seats.limit : false;

  return (
    <Page>
      <PageHeader
        title="Members"
        description={
          seats ? (
            <span>
              {seats.members} of {seats.limit} people on {seats.planLabel}
              {seats.pendingInvites > 0
                ? `, ${seats.pendingInvites} ${seats.pendingInvites === 1 ? "invitation" : "invitations"} open`
                : ""}
            </span>
          ) : (
            `The people who share ${currentOrg.name}'s songs and services.`
          )
        }
      />

      {full ? (
        <div className="mt-6">
          <Notice kind="info">
            This workspace is full on its plan.{" "}
            <Link href="/dashboard/billing" className="font-medium underline">
              Upgrade for more people
            </Link>{" "}
            or revoke an invitation to add someone.
          </Notice>
        </div>
      ) : null}

      {isAdmin ? <InviteForm orgId={workspaceId} full={full} /> : null}

      {notice ? (
        <div className="mt-6">
          <Notice kind={notice.kind}>{notice.text}</Notice>
        </div>
      ) : null}

      {isAdmin && invitations.invites.length > 0 ? (
        <section className="mt-10">
          <SectionTitle aside={<span className="text-sm text-[#9aa1b1]">{invitations.invites.length}</span>}>
            Waiting to accept
          </SectionTitle>
          <ul className="mt-3 divide-y divide-[#eff0f4] overflow-hidden rounded-card border border-[#e7e9ef] bg-white">
            {invitations.invites.map((invite) => (
              <li key={invite.id} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:px-5">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-[#f1f2f6] text-[#9aa1b1]">
                    <Mail className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{invite.email}</p>
                    <p className="truncate text-sm text-[#9aa1b1]">
                      {workspaceRoleLabel(invite.userRole)}
                      {invite.role === "admin" ? " · Admin" : ""} ·{" "}
                      {invite.emailError ? "Email not sent" : invite.emailSent ? "Email sent" : "Sending"} ·{" "}
                      {expiresIn(invite.expiresAt)}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 pl-[52px] sm:pl-0">
                  <Button size="sm" variant="outline" onClick={() => void copy(invite.url, invite.id)}>
                    {copied === invite.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {copied === invite.id ? "Copied" : "Copy link"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void revokeInvite({ inviteId: invite.id })}
                    aria-label={`Revoke the invitation for ${invite.email}`}
                  >
                    <X className="h-4 w-4" /> Revoke
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-10">
        <SectionTitle aside={members ? <span className="text-sm text-[#9aa1b1]">{members.length}</span> : null}>
          Members
        </SectionTitle>
        <div className="mt-3">
          {membersError ? (
            <Notice kind="error">{membersError}</Notice>
          ) : members === null ? (
            <SkeletonRows rows={3} />
          ) : (
            <ul className="divide-y divide-[#eff0f4] overflow-hidden rounded-card border border-[#e7e9ef] bg-white">
              {members.map((member) => {
                const who = member.name ?? member.email ?? "They";
                return (
                  <MemberRow
                    key={member.userId}
                    member={member}
                    canManage={isAdmin}
                    onRole={(userRole) =>
                      void change(() => updateMember({ orgId: workspaceId, userId: member.userId, userRole }))
                    }
                    onAccess={(role) =>
                      void change(
                        () => updateMember({ orgId: workspaceId, userId: member.userId, role }),
                        role === "admin" ? `${who} is now an admin.` : `${who} is no longer an admin.`,
                      )
                    }
                    onRemove={() =>
                      void change(
                        () => removeMember({ orgId: workspaceId, userId: member.userId }),
                        `${who} was removed.`,
                      )
                    }
                  />
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </Page>
  );
}

function InviteForm({ orgId, full }: { orgId: Id<"organizations">; full: boolean }) {
  const createInvite = useMutation(api.invites.create);
  const [email, setEmail] = useState("");
  const [userRole, setUserRole] = useState<WorkspaceRole>("member");
  const [admin, setAdmin] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const onRole = (value: string) => {
    const role = normalizeWorkspaceRole(value);
    setUserRole(role);
    setAdmin(defaultAccessFor(role) === "admin");
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    if (!address) return;
    setSending(true);
    setNotice(null);
    try {
      const result = await createInvite({ orgId, email: address, role: admin ? "admin" : "user", userRole });
      setNotice({
        kind: "ok",
        text: result.resent ? `Invitation sent to ${address} again.` : `Invitation sent to ${address}.`,
      });
      setEmail("");
    } catch (error) {
      setNotice({ kind: "error", text: friendlyError(error) });
    } finally {
      setSending(false);
    }
  };

  return (
    <Card className="mt-6">
      <form onSubmit={onSubmit}>
        <h2 className="font-semibold">Invite someone</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_200px_auto]">
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa1b1]" />
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
              aria-label="Email address"
              className={cx(fieldClass, "pl-10")}
            />
          </div>
          <Select value={userRole} onChange={(event) => onRole(event.target.value)} aria-label="Role">
            {WORKSPACE_ROLES.map((role) => (
              <option key={role.value} value={role.value}>
                {role.label}
              </option>
            ))}
          </Select>
          <Button type="submit" busy={sending} disabled={!email.trim() || full}>
            Send invitation
          </Button>
        </div>
        <div className="mt-4">
          <Toggle
            checked={admin}
            onChange={setAdmin}
            label="Admin access"
            description="Can invite and remove people, change roles and edit the workspace's settings."
          />
        </div>
        <div className="mt-4">
          {notice ? (
            <Notice kind={notice.kind}>{notice.text}</Notice>
          ) : (
            <p className="text-sm text-[#9aa1b1]">
              They get an email with a link, and see the invitation in the desktop app when they sign in.
            </p>
          )}
        </div>
      </form>
    </Card>
  );
}

function MemberRow({
  member,
  canManage,
  onRole,
  onAccess,
  onRemove,
}: {
  member: Member;
  canManage: boolean;
  onRole: (userRole: string) => void;
  onAccess: (role: "admin" | "user") => void;
  onRemove: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const name = member.name ?? member.email ?? "Member";
  const canEditRole = canManage || member.isYou;
  const isAdmin = member.role === "admin";

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpen]);

  return (
    <li className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar src={member.imageUrl} name={name} size={40} />
        <div className="min-w-0">
          <p className="truncate font-medium">
            {name} {member.isYou ? <span className="font-normal text-[#9aa1b1]">(you)</span> : null}
          </p>
          <p className="truncate text-sm text-[#9aa1b1]">{member.email}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 pl-[52px] sm:pl-0">
        {canEditRole ? (
          <Select
            compact
            className="w-40"
            value={normalizeWorkspaceRole(member.userRole)}
            onChange={(event) => onRole(event.target.value)}
            aria-label={`${name}'s role`}
          >
            {WORKSPACE_ROLES.map((role) => (
              <option key={role.value} value={role.value}>
                {role.label}
              </option>
            ))}
          </Select>
        ) : (
          <span className="rounded-[6px] bg-[#f1f2f6] px-2 py-0.5 text-xs text-[#6b7285]">
            {workspaceRoleLabel(member.userRole)}
          </span>
        )}

        {/* A fixed slot, so the role pickers line up whether or not the row has the badge. */}
        <span className="flex flex-none sm:w-[76px] sm:justify-end">
          {isAdmin ? (
            <span className="inline-flex items-center gap-1 rounded-[6px] bg-[#eceefb] px-2 py-0.5 text-xs font-medium text-[#3c418f]">
              <ShieldCheck className="h-3.5 w-3.5" /> Admin
            </span>
          ) : null}
        </span>

        {canManage && !member.isYou ? (
          confirmRemove ? (
            <span className="flex flex-none gap-1">
              <Button size="sm" variant="danger" onClick={onRemove}>
                Remove
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>
                Cancel
              </Button>
            </span>
          ) : (
            <div className="relative ml-auto flex-none sm:ml-0">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setMenuOpen((open) => !open);
                }}
                aria-label={`Manage ${name}`}
                aria-expanded={menuOpen}
                className="flex h-9 w-9 items-center justify-center rounded-full text-[#6b7285] transition hover:bg-[#f1f2f6] hover:text-[#1d2240]"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {menuOpen ? (
                <div className="absolute right-0 top-10 z-20 w-52 rounded-[10px] border border-[#e7e9ef] bg-white p-1 shadow-[0_12px_32px_rgba(20,24,50,0.12)]">
                  <button
                    type="button"
                    onClick={() => onAccess(isAdmin ? "user" : "admin")}
                    className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-[#f1f2f6]"
                  >
                    {isAdmin ? "Remove admin access" : "Make admin"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmRemove(true)}
                    className="w-full rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                  >
                    Remove from workspace
                  </button>
                </div>
              ) : null}
            </div>
          )
        ) : canManage ? (
          <span className="hidden h-9 w-9 flex-none sm:block" aria-hidden="true" />
        ) : null}
      </div>
    </li>
  );
}
