"use client";

import { useState } from "react";
import { Check, Copy, Mail, UserPlus } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { toast } from "sonner";
import { api } from "@present/backend/convex/_generated/api";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

/**
 * Invitations in the desktop app (`convex/invites.ts`): the ones waiting for
 * whoever is signed in, and a way for an admin to send one. The website has
 * the same, at /invite/<token> and in the dashboard's Members page; either
 * place sees an invitation the moment the other sends it.
 */

/** What a Convex error says, without the transport's prefix. */
export const invitationError = (error: unknown): string => {
  if (error instanceof ConvexError && typeof error.data === "string") return error.data;
  const message = error instanceof Error ? error.message : "";
  return message.match(/ConvexError: (.*?)(?:\n|$)/)?.[1] ?? "Something went wrong. Try again.";
};

export type MyInvitation = NonNullable<ReturnType<typeof useMyInvitations>>[number];

/** The invitations waiting for the signed-in person. */
export const useMyInvitations = (enabled: boolean) =>
  useQuery(api.invites.listMine, enabled ? {} : "skip");

/**
 * The active workspace's seats and open invitations, when the signed-in
 * person is one of its admins; `null` when they are not.
 */
export const useWorkspaceInvitations = (orgId: string | null) =>
  useQuery(api.invites.listForWorkspace, orgId ? { orgId: orgId as Id<"organizations"> } : "skip");

const initials = (value: string) =>
  value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "P";

/** One invitation, to accept or decline, for the account menu. */
export function InvitationRow({
  invitation,
  onJoined,
}: {
  invitation: MyInvitation;
  onJoined: (orgId: string, orgName: string) => void;
}) {
  const accept = useMutation(api.invites.accept);
  const decline = useMutation(api.invites.decline);
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);

  const run = async (action: "accept" | "decline") => {
    setBusy(action);
    try {
      if (action === "accept") {
        const joined = await accept({ token: invitation.token });
        onJoined(joined.orgId, joined.orgName);
      } else {
        await decline({ token: invitation.token });
      }
    } catch (error) {
      toast.error(invitationError(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-1 my-0.5 flex items-center gap-2 rounded-md px-2 py-2">
      {invitation.orgLogo ? (
        <img src={invitation.orgLogo} alt="" className="h-7 w-7 flex-none rounded-full object-cover" crossOrigin="anonymous" />
      ) : (
        <span className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
          {initials(invitation.orgName)}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{invitation.orgName}</p>
        <p className="truncate text-[10px] text-muted-foreground">
          {invitation.invitedByName ? `From ${invitation.invitedByName}` : "Invitation"}
          {invitation.role === "admin" ? " · as admin" : ""}
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        className="h-6 px-2 text-[10px]"
        disabled={busy !== null}
        onClick={() => void run("accept")}
      >
        {busy === "accept" ? "Joining…" : "Join"}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-6 px-2 text-[10px] text-muted-foreground"
        disabled={busy !== null}
        onClick={() => void run("decline")}
      >
        Decline
      </Button>
    </div>
  );
}

/** Invite someone to the active workspace by email. */
export function InvitePeopleDialog({
  open,
  onOpenChange,
  orgId,
  orgName,
  onManageMembers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  orgName: string;
  onManageMembers: () => void;
}) {
  const workspace = useWorkspaceInvitations(open ? orgId : null);
  const create = useMutation(api.invites.create);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ email: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const seats = workspace?.seats;
  const full = seats ? seats.members + seats.pendingInvites >= seats.limit : false;

  const reset = () => {
    setEmail("");
    setRole("user");
    setError(null);
    setSent(null);
    setCopied(false);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    if (!address) return;
    setSending(true);
    setError(null);
    try {
      const result = await create({ orgId: orgId as Id<"organizations">, email: address, role });
      setSent({ email: address, url: result.url });
      setEmail("");
    } catch (failure) {
      setError(invitationError(failure));
    } finally {
      setSending(false);
    }
  };

  const copyLink = async () => {
    if (!sent) return;
    await navigator.clipboard.writeText(sent.url).catch((): void => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <AlertDialogContent className="sm:max-w-[420px]">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-primary" /> Invite people to {orgName}
          </AlertDialogTitle>
          <AlertDialogDescription>
            They get an email with a link, and the invitation waits in Present for them when they sign in with that address.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {seats ? (
          <p className="text-[11px] text-muted-foreground">
            {seats.members} of {seats.limit} people on {seats.planLabel}
            {seats.pendingInvites > 0 ? `, ${seats.pendingInvites} invited` : ""}
          </p>
        ) : null}

        {workspace === null ? (
          <p className="text-xs text-muted-foreground">Only an admin of {orgName} can invite people.</p>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Mail className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="email"
                  autoFocus
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@example.com"
                  className="h-8 pl-8 text-xs"
                />
              </div>
              <select
                value={role}
                onChange={(event) => setRole(event.target.value === "admin" ? "admin" : "user")}
                aria-label="Role"
                className="h-8 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring"
              >
                <option value="user">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            {full && !error ? (
              <p className="text-xs text-muted-foreground">This workspace is full on its plan. Upgrade or revoke an invitation to add someone.</p>
            ) : null}
            {sent ? (
              <div className="flex items-center gap-2 rounded-md border border-border/70 bg-muted/40 px-2.5 py-2">
                <Check className="h-3.5 w-3.5 flex-none text-primary" />
                <p className="min-w-0 flex-1 truncate text-xs">Invited {sent.email}</p>
                <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => void copyLink()}>
                  <Copy className="h-3 w-3" /> {copied ? "Copied" : "Copy link"}
                </Button>
              </div>
            ) : null}
            <Button type="submit" className="h-8 w-full text-xs" disabled={sending || !email.trim() || full || workspace === undefined}>
              {sending ? "Sending…" : "Send invitation"}
            </Button>
          </form>
        )}

        <AlertDialogFooter className="sm:justify-between">
          <Button type="button" variant="ghost" className="h-8 text-xs" onClick={onManageMembers}>
            Manage members
          </Button>
          <AlertDialogCancel className="h-8 text-xs">Done</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
