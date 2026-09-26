"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SignInButton, SignUpButton, useClerk, useUser } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { Check, Loader2, MonitorSmartphone, X } from "lucide-react";

import { api } from "../../../../../../packages/backend/convex/_generated/api";
import { useWorkspaceStore } from "../../../../../../packages/shared/src/store/workspace";

/** What a Convex error says, without the transport's prefix. */
const friendly = (error: unknown): string => {
  const data = (error as { data?: unknown } | null)?.data;
  if (typeof data === "string") return data;
  const message = error instanceof Error ? error.message : "";
  return message.match(/ConvexError: (.*?)(?:\n|$)/)?.[1] ?? "Something went wrong. Try again.";
};

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "P";

/**
 * The page an invitation link opens (`convex/invites.ts`).
 *
 * Readable before signing in, so whoever opens it can see what they are being
 * asked to join; accepting needs them signed in as the address it was sent to.
 */
export function InvitationClient({ token }: { token: string }) {
  const router = useRouter();
  const { isLoaded: isUserLoaded, user } = useUser();
  const { signOut } = useClerk();
  const { isAuthenticated } = useConvexAuth();
  const invitation = useQuery(api.invites.getByToken, { token });
  const accept = useMutation(api.invites.accept);
  const decline = useMutation(api.invites.decline);
  const setWorkspace = useWorkspaceStore((state) => state.setWorkspace);

  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ joined: string } | { declined: true } | null>(null);

  const here = typeof window === "undefined" ? `/invite/${token}` : window.location.pathname;

  const onAccept = async () => {
    setBusy("accept");
    setError(null);
    try {
      const joined = await accept({ token });
      setWorkspace("organization", joined.orgId);
      setOutcome({ joined: joined.orgName });
    } catch (caught) {
      setError(friendly(caught));
    } finally {
      setBusy(null);
    }
  };

  const onDecline = async () => {
    setBusy("decline");
    setError(null);
    try {
      await decline({ token });
      setOutcome({ declined: true });
    } catch (caught) {
      setError(friendly(caught));
    } finally {
      setBusy(null);
    }
  };

  const card = (children: React.ReactNode) => (
    <main className="flex min-h-screen items-center justify-center bg-black px-4 py-16 text-white">
      <div className="w-full max-w-md rounded-[2rem] border border-white/10 bg-white/[0.04] p-8 shadow-[0_0_60px_-20px_rgba(82,39,255,0.35)]">
        {children}
      </div>
    </main>
  );

  if (invitation === undefined || !isUserLoaded) {
    return card(
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-white/60">
        <Loader2 className="h-4 w-4 animate-spin" /> Opening your invitation
      </div>,
    );
  }

  if (invitation === null) {
    return card(
      <div className="space-y-3 text-center">
        <h1 className="text-xl font-semibold">This invitation doesn&apos;t exist</h1>
        <p className="text-sm text-white/60">Check the link, or ask whoever invited you to send a new one.</p>
        <Link href="/" className="inline-block pt-2 text-sm text-primary hover:underline">Go to Present</Link>
      </div>,
    );
  }

  if (outcome && "joined" in outcome) {
    return card(
      <div className="space-y-5 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
          <Check className="h-6 w-6" />
        </span>
        <div className="space-y-2">
          <h1 className="text-xl font-semibold">You&apos;re in {outcome.joined}</h1>
          <p className="text-sm text-white/60">Its songs, services and themes are yours to use now, on every device you sign in to.</p>
        </div>
        <div className="flex flex-col gap-2">
          <a href="present://open" className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-white transition hover:bg-primary/90">
            <MonitorSmartphone className="h-4 w-4" /> Open the desktop app
          </a>
          <button type="button" onClick={() => router.push("/dashboard")} className="rounded-xl border border-white/10 py-3 text-sm font-medium text-white/80 transition hover:bg-white/5">
            Go to the dashboard
          </button>
          <Link href="/download" className="pt-1 text-xs text-white/50 hover:text-white/80">Don&apos;t have the app? Download it</Link>
        </div>
      </div>,
    );
  }

  if (outcome && "declined" in outcome) {
    return card(
      <div className="space-y-3 text-center">
        <h1 className="text-xl font-semibold">Invitation declined</h1>
        <p className="text-sm text-white/60">Nothing changes for you. If that was a mistake, ask for a new invitation.</p>
      </div>,
    );
  }

  const closed =
    invitation.state === "accepted" ? "This invitation has already been accepted."
    : invitation.state === "declined" ? "This invitation was declined."
    : invitation.state === "revoked" ? "This invitation was withdrawn."
    : invitation.state === "expired" ? "This invitation has expired. Ask for a new one."
    : null;

  return card(
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        {invitation.orgLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={invitation.orgLogo} alt="" className="h-14 w-14 rounded-2xl object-cover" />
        ) : (
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/20 text-lg font-semibold text-primary">
            {initialsOf(invitation.orgName)}
          </span>
        )}
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-white/50">Invitation</p>
          <h1 className="truncate text-xl font-semibold">{invitation.orgName}</h1>
        </div>
      </div>

      <p className="text-sm leading-relaxed text-white/70">
        {invitation.invitedByName ?? "Someone"} invited you to join {invitation.orgName} on Present
        {invitation.role === "admin" ? " as an admin" : ""}, to share its songs, services and themes.
      </p>

      {closed ? (
        <p className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/70">{closed}</p>
      ) : !user || !isAuthenticated ? (
        <div className="space-y-3">
          <p className="text-xs text-white/50">Sign in with {invitation.emailHint} to accept it.</p>
          <SignInButton mode="modal" forceRedirectUrl={here}>
            <button type="button" className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white transition hover:bg-primary/90">
              Sign in to accept
            </button>
          </SignInButton>
          <SignUpButton mode="modal" forceRedirectUrl={here}>
            <button type="button" className="w-full rounded-xl border border-white/10 py-3 text-sm font-medium text-white/80 transition hover:bg-white/5">
              Create an account
            </button>
          </SignUpButton>
        </div>
      ) : !invitation.isForSignedInUser ? (
        <div className="space-y-3">
          <p className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
            This invitation is for {invitation.emailHint}, and you&apos;re signed in as {user.primaryEmailAddress?.emailAddress}.
          </p>
          <button type="button" onClick={() => void signOut({ redirectUrl: here })} className="w-full rounded-xl border border-white/10 py-3 text-sm font-medium text-white/80 transition hover:bg-white/5">
            Sign in with another account
          </button>
        </div>
      ) : (
        <div className="flex gap-3">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void onDecline()}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 py-3 text-sm font-medium text-white/80 transition hover:bg-white/5 disabled:opacity-50"
          >
            {busy === "decline" ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} Decline
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void onAccept()}
            className="inline-flex flex-[2] items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:opacity-50"
          >
            {busy === "accept" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Accept and join
          </button>
        </div>
      )}

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </div>,
  );
}
