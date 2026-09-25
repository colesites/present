"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { Check, Copy, Loader2, Mail, ShieldCheck, Trash2, UserPlus, X } from "lucide-react";

import { api } from "../../../../../../packages/backend/convex/_generated/api";
import type { Id } from "../../../../../../packages/backend/convex/_generated/dataModel";
import type { DashboardOrganization } from "../types";
import { getInitials } from "../types";

type Member = {
  userId: string;
  name: string | null;
  email: string | null;
  imageUrl: string | null;
  role: string;
  userRole: string | null;
  joinedAt: number;
  isYou: boolean;
};

/** What a Convex error says, without the transport's prefix. */
const friendly = (error: unknown): string => {
  const data = (error as { data?: unknown } | null)?.data;
  if (typeof data === "string") return data;
  const message = error instanceof Error ? error.message : "";
  return message.match(/ConvexError: (.*?)(?:\n|$)/)?.[1] ?? "Something went wrong. Try again.";
};

const expiresIn = (at: number) => {
  const days = Math.max(0, Math.ceil((at - Date.now()) / 86_400_000));
  return days <= 1 ? "Expires today" : `Expires in ${days} days`;
};

/**
 * Who is in the workspace, who is invited, and room for one more.
 *
 * Everyone in a workspace sees its members; only admins can invite, revoke
 * and remove. Invitations are accepted by the person invited, on the website
 * or in the desktop app (`convex/invites.ts`).
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
  const createInvite = useMutation(api.invites.create);
  const revokeInvite = useMutation(api.invites.revoke);
  const removeMember = useMutation(api.users.removeUserFromOrganization);

  const [members, setMembers] = useState<Member[] | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const isAdmin = invitations !== null && invitations !== undefined;

  const loadMembers = useCallback(async () => {
    if (!orgId) return;
    setMembersError(null);
    try {
      const response = await fetch(`/api/organizations/members?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await response.text());
      setMembers(((await response.json()) as { members: Member[] }).members);
    } catch {
      setMembersError("Couldn't load the members. Refresh to try again.");
    }
  }, [orgId]);

  useEffect(() => {
    setMembers(null);
    void loadMembers();
  }, [loadMembers]);

  const copy = async (url: string, id: string) => {
    await navigator.clipboard.writeText(url).catch(() => undefined);
    setCopied(id);
    window.setTimeout(() => setCopied((current) => (current === id ? null : current)), 1600);
  };

  const onInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!orgId || !email.trim()) return;
    setSending(true);
    setNotice(null);
    try {
      const result = await createInvite({ orgId, email: email.trim(), role });
      setNotice({
        kind: "ok",
        text: result.resent ? `Invitation sent to ${email.trim()} again.` : `Invitation sent to ${email.trim()}.`,
      });
      setEmail("");
    } catch (error) {
      setNotice({ kind: "error", text: friendly(error) });
    } finally {
      setSending(false);
    }
  };

  const onRemove = async (member: Member) => {
    if (!orgId) return;
    try {
      await removeMember({ orgId, userId: member.userId });
      setConfirmRemove(null);
      await loadMembers();
    } catch (error) {
      setNotice({ kind: "error", text: friendly(error) });
      setConfirmRemove(null);
    }
  };

  if (!currentOrg && isLoading) {
    return (
      <div className="min-h-full px-18 py-14 text-[#232946]">
        <Heading />
        <div className="mt-10 space-y-2">
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-[68px] animate-pulse rounded-[20px] bg-[#f4f5f9]" />
          ))}
        </div>
      </div>
    );
  }

  if (!currentOrg) {
    return (
      <div className="min-h-full px-18 py-14 text-[#232946]">
        <Heading />
        <div className="mt-10 rounded-[28px] border border-primary/10 bg-primary/4 px-8 py-10">
          <h2 className="text-xl font-semibold tracking-[-0.03em]">Members belong to an organization</h2>
          <p className="mt-2 max-w-xl text-[0.98rem] leading-7 text-[#7d8798]">
            Your personal workspace is just you. Switch to an organization in the sidebar, or create one, to invite your team.
          </p>
          <Link href="/dashboard/organization/setup" className="mt-6 inline-flex rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary/90">
            Create an organization
          </Link>
        </div>
      </div>
    );
  }

  const seats = invitations?.seats;
  const full = seats ? seats.members + seats.pendingInvites >= seats.limit : false;

  return (
    <div className="min-h-full px-18 py-14 text-[#232946]">
      <Heading orgName={currentOrg.name} />

      {seats ? (
        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-[22px] border border-primary/10 bg-primary/4 px-6 py-4 text-sm">
          <span className="font-semibold">{seats.members} of {seats.limit} people</span>
          <span className="text-[#7d8798]">{seats.planLabel} plan</span>
          {seats.pendingInvites > 0 ? (
            <span className="text-[#7d8798]">{seats.pendingInvites} invitation{seats.pendingInvites === 1 ? "" : "s"} open</span>
          ) : null}
          {full ? (
            <Link href="/pricing" className="ml-auto font-semibold text-primary hover:underline">Upgrade for more people</Link>
          ) : null}
        </div>
      ) : null}

      {isAdmin ? (
        <form onSubmit={onInvite} className="mt-8 rounded-[28px] border border-[#ececf2] bg-white p-6 shadow-[0_10px_30px_rgba(35,41,70,0.04)]">
          <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.28em] text-primary/65">
            <UserPlus className="h-4 w-4" /> Invite someone
          </div>
          <div className="mt-4 flex flex-col gap-3 md:flex-row">
            <div className="relative flex-1">
              <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa3b2]" />
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@church.org"
                className="h-12 w-full rounded-2xl border border-[#e4e6ee] bg-[#fafbfd] pl-11 pr-4 text-[0.95rem] outline-none transition focus:border-primary/50 focus:bg-white"
              />
            </div>
            <select
              value={role}
              onChange={(event) => setRole(event.target.value === "admin" ? "admin" : "user")}
              className="h-12 rounded-2xl border border-[#e4e6ee] bg-[#fafbfd] px-4 text-[0.95rem] outline-none focus:border-primary/50"
              aria-label="Role"
            >
              <option value="user">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button
              type="submit"
              disabled={sending || !email.trim() || full}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-primary px-6 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:opacity-50"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Send invitation
            </button>
          </div>
          {notice ? (
            <p className={`mt-3 text-sm ${notice.kind === "ok" ? "text-emerald-600" : "text-red-500"}`}>{notice.text}</p>
          ) : (
            <p className="mt-3 text-sm text-[#9aa3b2]">They&apos;ll get an email with a link, and see it in the desktop app when they sign in.</p>
          )}
        </form>
      ) : null}

      {isAdmin && invitations.invites.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-[0.72rem] font-semibold uppercase tracking-[0.28em] text-primary/65">Waiting to accept</h2>
          <ul className="mt-4 divide-y divide-[#f0f1f5] rounded-[24px] border border-[#ececf2] bg-white">
            {invitations.invites.map((invite) => (
              <li key={invite.id} className="flex flex-wrap items-center gap-4 px-6 py-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f3f1ff] text-primary">
                  <Mail className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{invite.email}</p>
                  <p className="text-sm text-[#9aa3b2]">
                    {invite.role === "admin" ? "Admin · " : ""}
                    {invite.emailError ? invite.emailError : invite.emailSent ? "Email sent" : "Sending…"} · {expiresIn(invite.expiresAt)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void copy(invite.url, invite.id)}
                  className="inline-flex items-center gap-2 rounded-full border border-[#e4e6ee] px-4 py-2 text-sm font-medium transition hover:border-primary/40 hover:text-primary"
                >
                  {copied === invite.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied === invite.id ? "Copied" : "Copy link"}
                </button>
                <button
                  type="button"
                  onClick={() => void revokeInvite({ inviteId: invite.id })}
                  className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm text-[#9aa3b2] transition hover:text-red-500"
                  aria-label={`Revoke the invitation for ${invite.email}`}
                >
                  <X className="h-4 w-4" /> Revoke
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-10">
        <h2 className="text-[0.72rem] font-semibold uppercase tracking-[0.28em] text-primary/65">Members</h2>
        {membersError ? (
          <p className="mt-4 text-sm text-red-500">{membersError}</p>
        ) : members === null ? (
          <div className="mt-4 space-y-2">
            {[0, 1, 2].map((row) => (
              <div key={row} className="h-[68px] animate-pulse rounded-[20px] bg-[#f4f5f9]" />
            ))}
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-[#f0f1f5] rounded-[24px] border border-[#ececf2] bg-white">
            {members.map((member) => (
              <li key={member.userId} className="flex flex-wrap items-center gap-4 px-6 py-4">
                {member.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={member.imageUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
                ) : (
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                    {getInitials(member.name ?? member.email ?? "?")}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {member.name ?? member.email ?? "Member"} {member.isYou ? <span className="text-[#9aa3b2]">(you)</span> : null}
                  </p>
                  <p className="truncate text-sm text-[#9aa3b2]">{member.email}</p>
                </div>
                {member.role === "admin" ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                    <ShieldCheck className="h-3.5 w-3.5" /> Admin
                  </span>
                ) : (
                  <span className="rounded-full bg-[#f4f5f9] px-3 py-1 text-xs font-medium text-[#7d8798]">Member</span>
                )}
                {isAdmin && !member.isYou ? (
                  confirmRemove === member.userId ? (
                    <span className="flex items-center gap-2">
                      <button type="button" onClick={() => void onRemove(member)} className="rounded-full bg-red-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-600">
                        Remove
                      </button>
                      <button type="button" onClick={() => setConfirmRemove(null)} className="rounded-full px-3 py-2 text-sm text-[#7d8798] hover:text-[#232946]">
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmRemove(member.userId)}
                      className="rounded-full p-2 text-[#b3bac7] transition hover:bg-red-50 hover:text-red-500"
                      aria-label={`Remove ${member.name ?? member.email}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Heading({ orgName }: { orgName?: string }) {
  return (
    <div className="max-w-4xl">
      <p className="text-[0.72rem] font-semibold uppercase tracking-[0.34em] text-primary/65">Team</p>
      <h1 className="mt-5 text-[4.1rem] font-semibold leading-none tracking-[-0.07em] text-[#232946]">Members</h1>
      <p className="mt-5 max-w-3xl text-[1.08rem] leading-7 text-[#7d8798]">
        {orgName ? `The people who share ${orgName}'s songs, services and themes.` : "The people you present with."}
      </p>
    </div>
  );
}
