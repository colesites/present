"use client";

import { useEffect, useMemo, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../../../../../../packages/backend/convex/_generated/api";
import { useRouter } from "next/navigation";
import { Building2, Check, ImagePlus, Link2, Mail, Users } from "lucide-react";
import { useWorkspaceStore } from "../../../../../../../packages/shared/src/store/workspace";

interface OrganizationSetupClientProps {
  desktopSessionToken?: string | null;
  source?: string | null;
}

export default function OrganizationSetupClient({
  desktopSessionToken,
  source,
}: OrganizationSetupClientProps) {
  const router = useRouter();
  const { user, isLoaded: isUserLoaded } = useUser();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { type: workspaceType, id: workspaceId, setWorkspace } =
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
  const activeOrganizationId =
    workspaceType === "organization" && workspaceId
      ? workspaceId
      : organizations[0]?.id ?? null;
  const isDesktopSource = source === "desktop";

  const [mode, setMode] = useState<"create" | "join">("create");
  const [orgName, setOrgName] = useState("");
  const [orgType, setOrgType] = useState("church");
  const [userRole, setUserRole] = useState("tech-director");
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [logoFileName, setLogoFileName] = useState<string | null>(null);
  const [joinOrganizationId, setJoinOrganizationId] = useState("");
  const [joinUserRole, setJoinUserRole] = useState("volunteer");
  const [inviteEmails, setInviteEmails] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("volunteer");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isInviting, setIsInviting] = useState(false);
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

  const completeDesktopFlow = (sessionToken: string) => {
    window.location.href = `present://auth?sessionToken=${encodeURIComponent(
      sessionToken
    )}`;
    window.setTimeout(() => {
      window.close();
    }, 350);
    window.setTimeout(() => {
      router.replace("/dashboard?setup=1");
    }, 900);
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
        await inviteMemberByEmail(nextOrgId, email, userRole);
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

  const handleJoinOrganization = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinOrganizationId.trim()) {
      setError("Organization ID is required to join.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/organizations/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId: joinOrganizationId.trim(),
          userRole: joinUserRole,
        }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Unable to join organization");
      }
      const payload = (await response.json()) as { orgId: string };
      setWorkspace("organization", payload.orgId);

      if (isDesktopSource && desktopSessionToken) {
        completeDesktopFlow(desktopSessionToken);
        return;
      }

      router.replace("/dashboard");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to join organization"
      );
      setIsSubmitting(false);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrganizationId) {
      setError("No organization selected.");
      return;
    }
    if (!inviteEmail.trim()) {
      setError("Member email is required.");
      return;
    }

    setIsInviting(true);
    setError(null);
    setSuccess(null);
    try {
      await inviteMemberByEmail(
        activeOrganizationId,
        inviteEmail.trim().toLowerCase(),
        inviteRole
      );
      setInviteEmail("");
      setSuccess("Invitation sent. The user was added if their account exists.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to invite member");
    } finally {
      setIsInviting(false);
    }
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
          <div className="rounded-xl border border-border bg-background/60 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">Invite members</h2>
              <span className="text-xs text-muted-foreground">
                Share org ID: {activeOrganizationId}
              </span>
            </div>
            <form onSubmit={handleInvite} className="grid gap-3 md:grid-cols-[1fr_220px_150px]">
              <input
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="member@email.com"
                className="rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                required
              />
              <select
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value)}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="tech-director">Tech Director</option>
                <option value="pastor">Pastor</option>
                <option value="worship-leader">Worship Leader</option>
                <option value="volunteer">Volunteer</option>
                <option value="admin">Administrator</option>
              </select>
              <button
                type="submit"
                disabled={isInviting}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Mail className="h-4 w-4" />
                {isInviting ? "Inviting..." : "Invite"}
              </button>
            </form>
            <p className="mt-2 text-xs text-muted-foreground">
              Invitees must already have an account. They can also join using the org ID above.
            </p>
          </div>
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
            Join Organization
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
                  <option value="church">Church</option>
                  <option value="school">School</option>
                  <option value="business">Business</option>
                  <option value="nonprofit">Non-Profit</option>
                  <option value="other">Other</option>
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
                  <option value="tech-director">Tech Director</option>
                  <option value="pastor">Pastor</option>
                  <option value="worship-leader">Worship Leader</option>
                  <option value="volunteer">Volunteer</option>
                  <option value="admin">Administrator</option>
                  <option value="other">Other</option>
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
          <form onSubmit={handleJoinOrganization} className="space-y-4 rounded-xl border border-border bg-background/60 p-4">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Link2 className="h-4 w-4" />
                Organization ID
              </label>
              <input
                type="text"
                value={joinOrganizationId}
                onChange={(event) => setJoinOrganizationId(event.target.value)}
                placeholder="Paste organization ID shared by your admin"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Your Role</label>
              <select
                value={joinUserRole}
                onChange={(event) => setJoinUserRole(event.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="tech-director">Tech Director</option>
                <option value="pastor">Pastor</option>
                <option value="worship-leader">Worship Leader</option>
                <option value="volunteer">Volunteer</option>
                <option value="admin">Administrator</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? "Joining..." : "Join Organization"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
