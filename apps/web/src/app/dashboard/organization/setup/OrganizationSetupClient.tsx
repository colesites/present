"use client";

import { useEffect, useMemo, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../../../../../../packages/backend/convex/_generated/api";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Building2, Check, ImagePlus, Link2, Users } from "lucide-react";
import { useWorkspaceStore } from "../../../../../../../packages/shared/src/store/workspace";
import { WORKSPACE_ROLES, WORKSPACE_TYPES } from "../../../../../../../packages/shared/src/workspace-roles";

/** What a Convex error says, without the transport's prefix. */
const friendlyError = (error: Error): string => {
  const data = (error as Error & { data?: unknown }).data;
  if (typeof data === "string") return data;
  const match = error.message.match(/ConvexError: (.*?)(?:\n|$)/);
  return match?.[1] ?? error.message;
};

interface OrganizationSetupClientProps {
  desktopSessionToken?: string | null;
  /** The loopback address a development desktop is listening on, if any. */
  desktopComeBackTo?: string | null;
  source?: string | null;
}

export default function OrganizationSetupClient({
  desktopSessionToken,
  desktopComeBackTo,
  source,
}: OrganizationSetupClientProps) {
  const router = useRouter();
  const { user, isLoaded: isUserLoaded } = useUser();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { setWorkspace } =
    useWorkspaceStore();
  const createOrganization = useMutation(api.users.createOrganization);
  const organizationsData = useQuery(
    api.users.listMyOrganizations,
    isAuthenticated ? {} : "skip"
  ) as
    | Array<{
        id: string;
        name: string;
        slug: string;
        logo?: string | null;
        role: string;
        createdAt: number;
      }>
    | undefined;

  const organizations = useMemo(() => organizationsData ?? [], [organizationsData]);
  const isDesktopSource = source === "desktop";

  const [mode, setMode] = useState<"create" | "join">("create");
  const [orgName, setOrgName] = useState("");
  const [orgType, setOrgType] = useState("church");
  const [userRole, setUserRole] = useState("tech-director");
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [logoFileName, setLogoFileName] = useState<string | null>(null);
  const [invitationLink, setInvitationLink] = useState("");
  const myInvitations = useQuery(api.invites.listMine, isAuthenticated ? {} : "skip");
  const acceptInvitation = useMutation(api.invites.accept);
  const declineInvitation = useMutation(api.invites.decline);
  const [inviteEmails, setInviteEmails] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!isUserLoaded || isLoading) {
      return;
    }
    if (!user) {
      router.replace("/sign-in");
    }
  }, [isLoading, isUserLoaded, router, user]);

  // Handed back the way every sign-in is: the launch page opens `present://`
  // for an installed app, or the loopback address a development one is
  // listening on, which it checks, since this came in on the URL.
  const completeDesktopFlow = (sessionToken: string) => {
    const launch = new URLSearchParams({ sessionToken });
    if (desktopComeBackTo) {
      launch.set("redirect", desktopComeBackTo);
    }
    router.replace(`/auth/desktop/launch?${launch.toString()}`);
  };

  const inviteMemberByEmail = async (
    orgId: string,
    email: string,
    selectedRole: string
  ): Promise<void> => {
    const response = await fetch("/api/organizations/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orgId,
        email,
        role: "user",
        userRole: selectedRole,
      }),
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || "Failed to invite member");
    }
  };

  const handleLogoChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) {
      setLogoDataUrl(null);
      setLogoFileName(null);
      return;
    }
    if (file.size > 1_000_000) {
      setError("Logo must be 1MB or smaller.");
      event.currentTarget.value = "";
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result === "string") {
          resolve(result);
          return;
        }
        reject(new Error("Unable to read logo file"));
      };
      reader.onerror = () => reject(new Error("Unable to read logo file"));
      reader.readAsDataURL(file);
    });
    setLogoDataUrl(dataUrl);
    setLogoFileName(file.name);
    setError(null);
  };

  const handleCreateOrganization = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgName.trim()) {
      setError("Organization name is required.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await createOrganization({
        orgName: orgName.trim(),
        logo: logoDataUrl ?? undefined,
        orgType,
        userRole,
      });
      const nextOrgId = String(result.orgId);
      setWorkspace("organization", nextOrgId);

      const requestedInvites = inviteEmails
        .split(/[\n,]/)
        .map((value) => value.trim())
        .filter(Boolean);
      for (const email of requestedInvites) {
        await inviteMemberByEmail(nextOrgId, email, "member");
      }

      if (isDesktopSource && desktopSessionToken) {
        completeDesktopFlow(desktopSessionToken);
        return;
      }

      router.replace("/dashboard");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to create organization"
      );
      setIsSubmitting(false);
    }
  };

  // Workspaces are joined by invitation now: an admin invites an email, and
  // the person signed in with it accepts (`convex/invites.ts`). Joining by a
  // pasted workspace id, with nobody's say-so, is gone.
  const handleAcceptInvitation = async (token: string) => {
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const joined = await acceptInvitation({ token });
      setWorkspace("organization", joined.orgId);
      if (isDesktopSource && desktopSessionToken) {
        completeDesktopFlow(desktopSessionToken);
        return;
      }
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? friendlyError(err) : "Couldn't accept the invitation.");
      setIsSubmitting(false);
    }
  };

  const handleDeclineInvitation = async (token: string) => {
    setError(null);
    try {
      await declineInvitation({ token });
    } catch (err) {
      setError(err instanceof Error ? friendlyError(err) : "Couldn't decline the invitation.");
    }
  };

  const handleOpenInvitationLink = (e: React.FormEvent) => {
    e.preventDefault();
    const token = invitationLink.trim().split("/invite/").pop()?.split(/[?#]/)[0]?.trim();
    if (!token) {
      setError("Paste the invitation link from your email.");
      return;
    }
    router.push(`/invite/${encodeURIComponent(token)}`);
  };

  if (!isUserLoaded || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="text-center">
          <p className="text-muted-foreground">Loading account...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-3xl space-y-6 rounded-2xl border border-white/10 bg-card p-8 shadow-2xl">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">
            Set up your workspace
          </h1>
          <p className="text-sm text-muted-foreground">
            {isDesktopSource
              ? "Create or join an organization, then continue to the desktop app."
              : "Create or join an organization to unlock team collaboration."}
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive border border-destructive/20">
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">
            {success}
          </div>
        )}

        {organizations.length > 0 ? (
          <Link
            href="/dashboard/members"
            className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/60 p-4 transition hover:border-primary/40"
          >
            <span className="min-w-0">
              <span className="block text-base font-semibold">Invite your team</span>
              <span className="block text-xs text-muted-foreground">
                Send invitations with a role from the Members page. They join once they accept.
              </span>
            </span>
            <ArrowRight className="h-4 w-4 flex-none text-muted-foreground" />
          </Link>
        ) : null}

        <div className="inline-flex rounded-lg border border-border bg-background p-1">
          <button
            type="button"
            onClick={() => setMode("create")}
            className={`rounded-md px-3 py-1.5 text-sm ${
              mode === "create" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            }`}
          >
            Create Organization
          </button>
          <button
            type="button"
            onClick={() => setMode("join")}
            className={`rounded-md px-3 py-1.5 text-sm ${
              mode === "join" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            }`}
          >
            Join with an invitation
          </button>
        </div>

        {mode === "create" ? (
          <form onSubmit={handleCreateOrganization} className="space-y-4 rounded-xl border border-border bg-background/60 p-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Organization Name</label>
              <input
                type="text"
                value={orgName}
                onChange={(event) => setOrgName(event.target.value)}
                placeholder="Grace Community Church"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                required
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Building2 className="h-4 w-4" />
                  Organization Type
                </label>
                <select
                  value={orgType}
                  onChange={(event) => setOrgType(event.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  required
                >
                  {WORKSPACE_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Users className="h-4 w-4" />
                  Your Role
                </label>
                <select
                  value={userRole}
                  onChange={(event) => setUserRole(event.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  required
                >
                  {WORKSPACE_ROLES.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <ImagePlus className="h-4 w-4" />
                Logo (optional, max 1MB)
              </label>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={handleLogoChange}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              {logoFileName ? (
                <p className="text-xs text-muted-foreground">
                  Selected: {logoFileName}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Invite members (optional, emails separated by comma/new line)
              </label>
              <textarea
                value={inviteEmails}
                onChange={(event) => setInviteEmails(event.target.value)}
                rows={3}
                placeholder="teammate1@email.com, teammate2@email.com"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              {isSubmitting ? "Creating..." : "Create Organization"}
            </button>
          </form>
        ) : (
          <div className="space-y-4 rounded-xl border border-border bg-background/60 p-4">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold">Your invitations</h2>
              <p className="text-xs text-muted-foreground">
                Workspaces are joined by invitation. Ask an admin to invite {user?.primaryEmailAddress?.emailAddress ?? "your email"}.
              </p>
            </div>
            {myInvitations === undefined ? (
              <p className="text-sm text-muted-foreground">Looking for invitations…</p>
            ) : myInvitations.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
                No invitations for you yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {myInvitations.map((invitation) => (
                  <li key={invitation.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{invitation.orgName}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {invitation.invitedByName ? `From ${invitation.invitedByName}` : "Invitation"}
                        {invitation.role === "admin" ? " · as an admin" : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => void handleDeclineInvitation(invitation.token)}
                        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
                      >
                        Decline
                      </button>
                      <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => void handleAcceptInvitation(invitation.token)}
                        className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                      >
                        {isSubmitting ? "Joining…" : "Accept"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={handleOpenInvitationLink} className="space-y-2 border-t border-border pt-4">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Link2 className="h-4 w-4" />
                Have an invitation link?
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={invitationLink}
                  onChange={(event) => setInvitationLink(event.target.value)}
                  placeholder="https://present.multivrs.space/invite/…"
                  className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <button
                  type="submit"
                  className="rounded-md border border-border px-4 py-2 text-sm font-medium transition hover:bg-muted"
                >
                  Open
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
