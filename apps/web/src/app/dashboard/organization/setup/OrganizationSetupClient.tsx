"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useClerk, useUser } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ImagePlus, Loader2, X } from "lucide-react";
import { api } from "../../../../../../../packages/backend/convex/_generated/api";
import type { Id } from "../../../../../../../packages/backend/convex/_generated/dataModel";
import { useWorkspaceStore } from "../../../../../../../packages/shared/src/store/workspace";
import {
  WORKSPACE_ROLES,
  WORKSPACE_TYPES,
  workspaceRoleLabel,
} from "../../../../../../../packages/shared/src/workspace-roles";
import { Avatar, Button, Field, Notice, Select, cx, fieldClass, friendlyError } from "../../components/ui";
import { useBillingStatus } from "../../components/usage";

interface OrganizationSetupClientProps {
  desktopSessionToken?: string | null;
  /** The loopback address a development desktop is listening on, if any. */
  desktopComeBackTo?: string | null;
  source?: string | null;
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_LOGO_BYTES = 1_000_000;

/**
 * Where someone makes their first organization, or joins one they've been
 * invited to: after signing up, from the dashboard's switcher, and from the
 * desktop app, which it hands back to when done.
 *
 * Workspaces are joined by invitation only: an admin invites an email and
 * whoever is signed in with it accepts (`convex/invites.ts`).
 */
export default function OrganizationSetupClient({
  desktopSessionToken,
  desktopComeBackTo,
  source,
}: OrganizationSetupClientProps) {
  const router = useRouter();
  const { signOut } = useClerk();
  const { user, isLoaded: isUserLoaded } = useUser();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { setWorkspace } = useWorkspaceStore();
  const organizations = useQuery(api.users.listMyOrganizations, isAuthenticated ? {} : "skip") as
    | Array<{ id: string; name: string }>
    | undefined;
  const invitations = useQuery(api.invites.listMine, isAuthenticated ? {} : "skip");
  const isDesktopSource = source === "desktop";
  const email = user?.primaryEmailAddress?.emailAddress ?? "";

  // Someone who has been invited most likely came to join.
  const [chosenMode, setMode] = useState<"create" | "join" | null>(null);
  const mode = chosenMode ?? (invitations && invitations.length > 0 ? "join" : "create");

  useEffect(() => {
    if (isUserLoaded && !isLoading && !user) router.replace("/sign-in?next=/dashboard/organization/setup");
  }, [isLoading, isUserLoaded, router, user]);

  // Handed back the way every sign-in is: the launch page opens `present://`
  // for an installed app, or the loopback address a development one is
  // listening on, which it checks, since this came in on the URL.
  const finish = () => {
    if (isDesktopSource && desktopSessionToken) {
      const launch = new URLSearchParams({ sessionToken: desktopSessionToken });
      if (desktopComeBackTo) launch.set("redirect", desktopComeBackTo);
      router.replace(`/auth/desktop/launch?${launch.toString()}`);
      return;
    }
    router.replace("/dashboard");
  };

  if (!isUserLoaded || isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#111111]">
        <Loader2 className="h-6 w-6 animate-spin text-white/40" />
      </div>
    );
  }

  const hasOrganizations = (organizations?.length ?? 0) > 0;

  return (
    <div className="flex min-h-dvh flex-col bg-[#111111] text-white">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-5 py-5">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/present-mark.svg" alt="" width={26} height={26} className="h-[26px] w-[26px]" />
          <span className="text-[1.05rem] font-semibold tracking-[-0.02em]">Present</span>
        </Link>
        {hasOrganizations && !isDesktopSource ? (
          <Link href="/dashboard" className="text-sm text-white/60 transition hover:text-white">
            Back to the dashboard
          </Link>
        ) : null}
      </header>

      <main className="flex flex-1 justify-center px-4 pb-16 pt-4 sm:pt-10">
        <div className="w-full max-w-[560px]">
          <div className="overflow-hidden rounded-[20px] bg-white text-[#1d2240] shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
            <div className="px-6 pb-5 pt-6 sm:px-8 sm:pt-8">
              <h1 className="text-[1.6rem] font-semibold leading-tight tracking-[-0.03em]">
                {hasOrganizations ? "Add an organization" : "Set up your organization"}
              </h1>
              <p className="mt-1.5 text-[0.95rem] leading-6 text-[#6b7285]">
                Your songs, services and team live in an organization, and you can belong to more than one.
                {isDesktopSource ? " When you're done, we'll take you back to the Present app." : ""}
              </p>

              <div className="mt-5 grid grid-cols-2 gap-1 rounded-[12px] bg-[#f1f2f6] p-1" role="tablist" aria-label="Create or join">
                {(["create", "join"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="tab"
                    aria-selected={mode === option}
                    onClick={() => setMode(option)}
                    className={cx(
                      "flex h-9 items-center justify-center gap-2 rounded-[9px] text-sm transition",
                      mode === option ? "bg-white font-medium shadow-[0_1px_2px_rgba(20,24,50,0.1)]" : "text-[#6b7285] hover:text-[#1d2240]",
                    )}
                  >
                    {option === "create" ? "Create a new one" : "Join one"}
                    {option === "join" && invitations && invitations.length > 0 ? (
                      <span className="rounded-full bg-primary px-1.5 text-[0.7rem] font-semibold leading-5 text-white">
                        {invitations.length}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-[#eceef3] px-6 py-6 sm:px-8">
              {mode === "create" ? (
                <CreateForm
                  onCreated={(orgId) => {
                    setWorkspace("organization", orgId);
                    finish();
                  }}
                />
              ) : (
                <JoinPanel
                  email={email}
                  invitations={invitations}
                  onJoined={(orgId) => {
                    setWorkspace("organization", orgId);
                    finish();
                  }}
                />
              )}
            </div>
          </div>

          <p className="mt-6 text-center text-sm text-white/40">
            Signed in as {email || "you"}.{" "}
            <button
              type="button"
              onClick={() => void signOut({ redirectUrl: "/sign-in" })}
              className="text-white/60 underline-offset-2 transition hover:text-white hover:underline"
            >
              Use another account
            </button>
          </p>
        </div>
      </main>
    </div>
  );
}

function CreateForm({ onCreated }: { onCreated: (orgId: string) => void }) {
  const createOrganization = useMutation(api.users.createOrganization);
  const createInvite = useMutation(api.invites.create);
  const billing = useBillingStatus();
  const [name, setName] = useState("");
  const [orgType, setOrgType] = useState("church");
  const [userRole, setUserRole] = useState("tech-director");
  const [logo, setLogo] = useState<string | null>(null);
  const [emails, setEmails] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ orgId: string; failed: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // The creator is one of the people their plan allows.
  const seats = billing?.limits.workspaceMembers ?? null;
  const tooMany = seats !== null && emails.length > seats - 1;

  const pickLogo = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      setError("Use a logo under 1 MB.");
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    setLogo(dataUrl);
    setError(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createOrganization({ orgName: name.trim(), logo: logo ?? undefined, orgType, userRole });
      const orgId = String(result.orgId);
      const failed: string[] = [];
      for (const address of emails) {
        try {
          await createInvite({ orgId: orgId as Id<"organizations">, email: address, role: "user", userRole: "member" });
        } catch {
          failed.push(address);
        }
      }
      if (failed.length > 0) {
        setCreated({ orgId, failed });
        setBusy(false);
        return;
      }
      onCreated(orgId);
    } catch (failure) {
      setError(friendlyError(failure));
      setBusy(false);
    }
  };

  if (created) {
    return (
      <div className="space-y-4">
        <Notice kind="info">
          {name.trim()} is ready. {created.failed.length === 1 ? "One invitation" : `${created.failed.length} invitations`}{" "}
          couldn&apos;t be sent ({created.failed.join(", ")}), most likely because the plan is full. You can invite people from
          Members.
        </Notice>
        <Button className="w-full" onClick={() => onCreated(created.orgId)}>
          Continue
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="flex items-end gap-4">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label={logo ? "Change the logo" : "Add a logo"}
          className={cx(
            "group relative flex h-[68px] w-[68px] flex-none items-center justify-center overflow-hidden rounded-[14px] transition",
            logo ? "border border-[#e7e9ef]" : "border border-dashed border-[#cdd2dd] text-[#9aa1b1] hover:border-primary/50 hover:text-primary",
          )}
        >
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" className="h-full w-full object-cover" />
          ) : (
            <ImagePlus className="h-5 w-5" />
          )}
          {logo ? (
            <span className="absolute inset-0 hidden items-center justify-center bg-black/40 text-xs font-medium text-white group-hover:flex">
              Change
            </span>
          ) : null}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(event) => {
            void pickLogo(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <div className="min-w-0 flex-1">
          <Field label="Name" htmlFor="org-name">
            <input
              id="org-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Grace Community Church"
              maxLength={80}
              required
              autoFocus
              className={fieldClass}
            />
          </Field>
        </div>
      </div>
      {logo ? (
        <button type="button" onClick={() => setLogo(null)} className="-mt-3 text-xs text-[#9aa1b1] hover:text-[#1d2240]">
          Remove logo
        </button>
      ) : null}

      <div>
        <p className="text-sm font-medium">What kind of organization is it?</p>
        <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Organization type">
          {WORKSPACE_TYPES.map((type) => (
            <button
              key={type.value}
              type="button"
              role="radio"
              aria-checked={orgType === type.value}
              onClick={() => setOrgType(type.value)}
              className={cx(
                "h-8 rounded-[8px] border px-3 text-sm transition-colors",
                orgType === type.value
                  ? "border-[#1d2240] bg-[#1d2240] text-white"
                  : "border-[#dfe2ea] text-[#6b7285] hover:border-[#c9cdd9] hover:text-[#1d2240]",
              )}
            >
              {type.label}
            </button>
          ))}
        </div>
      </div>

      <Field label="Your role" htmlFor="org-role">
        <Select id="org-role" value={userRole} onChange={(event) => setUserRole(event.target.value)}>
          {WORKSPACE_ROLES.filter((role) => role.value !== "member").map((role) => (
            <option key={role.value} value={role.value}>
              {role.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Invite your team"
        hint={
          tooMany
            ? `${billing?.planLabel} allows ${seats} people, you included. Invite the rest after upgrading.`
            : seats !== null
              ? `Optional. Your ${billing?.planLabel} plan allows ${seats} people, you included. They get an email and join when they accept.`
              : "Optional. They get an email and join when they accept."
        }
      >
        <EmailChips emails={emails} onChange={setEmails} invalid={tooMany} />
      </Field>

      {error ? <Notice kind="error">{error}</Notice> : null}

      <Button type="submit" className="w-full" busy={busy} disabled={!name.trim() || tooMany}>
        {busy ? "Creating…" : "Create organization"}
      </Button>
    </form>
  );
}

/** Emails as chips: Enter, a comma or a space adds one; pasting a list adds them all. */
function EmailChips({ emails, onChange, invalid }: { emails: string[]; onChange: (next: string[]) => void; invalid: boolean }) {
  const [draft, setDraft] = useState("");
  const [bad, setBad] = useState(false);

  const add = (raw: string) => {
    const found = raw
      .split(/[\s,;]+/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    if (found.length === 0) return;
    const valid = found.filter((value) => EMAIL_SHAPE.test(value));
    setBad(valid.length < found.length);
    onChange([...new Set([...emails, ...valid])]);
    setDraft(found.filter((value) => !EMAIL_SHAPE.test(value)).join(" "));
  };

  return (
    <div
      className={cx(
        "flex min-h-10 flex-wrap items-center gap-1.5 rounded-control border bg-white px-2 py-1.5 transition focus-within:ring-[3px]",
        invalid || bad ? "border-red-300 focus-within:ring-red-100" : "border-[#dfe2ea] focus-within:border-primary/60 focus-within:ring-primary/15",
      )}
    >
      {emails.map((value) => (
        <span key={value} className="inline-flex items-center gap-1 rounded-[6px] bg-[#f1f2f6] py-0.5 pl-2 pr-1 text-sm">
          {value}
          <button
            type="button"
            onClick={() => onChange(emails.filter((each) => each !== value))}
            aria-label={`Remove ${value}`}
            className="rounded-[4px] p-0.5 text-[#9aa1b1] hover:bg-[#e3e5ec] hover:text-[#1d2240]"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(event) => {
          setBad(false);
          const value = event.target.value;
          if (/[\s,;]$/.test(value)) add(value);
          else setDraft(value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            add(draft);
          }
          if (event.key === "Backspace" && !draft && emails.length > 0) onChange(emails.slice(0, -1));
        }}
        onPaste={(event) => {
          event.preventDefault();
          add(`${draft} ${event.clipboardData.getData("text")}`);
        }}
        onBlur={() => add(draft)}
        placeholder={emails.length === 0 ? "name@example.com" : ""}
        aria-label="Email addresses to invite"
        className="h-7 min-w-[10rem] flex-1 bg-transparent px-1 text-[0.95rem] outline-none placeholder:text-[#a6adbb]"
      />
    </div>
  );
}

type Invitation = FunctionReturnType<typeof api.invites.listMine>[number];

function JoinPanel({
  email,
  invitations,
  onJoined,
}: {
  email: string;
  invitations: Invitation[] | undefined;
  onJoined: (orgId: string) => void;
}) {
  const router = useRouter();
  const accept = useMutation(api.invites.accept);
  const decline = useMutation(api.invites.decline);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState("");

  const respond = async (token: string, action: "accept" | "decline") => {
    setBusy(token);
    setError(null);
    try {
      if (action === "accept") {
        const joined = await accept({ token });
        onJoined(joined.orgId);
        return;
      }
      await decline({ token });
    } catch (failure) {
      setError(friendlyError(failure));
    }
    setBusy(null);
  };

  const openLink = (event: React.FormEvent) => {
    event.preventDefault();
    const token = link.trim().split("/invite/").pop()?.split(/[?#]/)[0]?.trim();
    if (!token) {
      setError("Paste the invitation link from your email.");
      return;
    }
    router.push(`/invite/${encodeURIComponent(token)}`);
  };

  const sorted = useMemo(() => [...(invitations ?? [])].sort((a, b) => b.createdAt - a.createdAt), [invitations]);

  return (
    <div className="space-y-5">
      {invitations === undefined ? (
        <div className="flex items-center gap-2 py-3 text-sm text-[#6b7285]">
          <Loader2 className="h-4 w-4 animate-spin" /> Looking for invitations…
        </div>
      ) : sorted.length === 0 ? (
        <div className="rounded-card border border-dashed border-[#dfe2ea] px-5 py-6 text-center">
          <p className="font-medium">No invitations yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-[#6b7285]">
            Ask an admin of your organization to invite <span className="text-[#1d2240]">{email || "your email"}</span> from their
            Members page. It shows up here straight away.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-[#eff0f4] overflow-hidden rounded-card border border-[#e7e9ef]">
          {sorted.map((invitation) => (
            <li key={invitation.id} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar src={invitation.orgLogo} name={invitation.orgName} size={40} shape="tile" />
                <div className="min-w-0">
                  <p className="truncate font-medium">{invitation.orgName}</p>
                  <p className="truncate text-sm text-[#9aa1b1]">
                    {invitation.invitedByName ? `From ${invitation.invitedByName} · ` : ""}
                    {workspaceRoleLabel(invitation.userRole)}
                    {invitation.role === "admin" ? ", admin" : ""}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 pl-[52px] sm:pl-0">
                <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void respond(invitation.token, "decline")}>
                  Decline
                </Button>
                <Button size="sm" busy={busy === invitation.token} disabled={busy !== null} onClick={() => void respond(invitation.token, "accept")}>
                  Join
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {error ? <Notice kind="error">{error}</Notice> : null}

      <form onSubmit={openLink}>
        <p className="text-sm font-medium">Or open an invitation link</p>
        <div className="mt-1.5 flex gap-2">
          <input
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="https://present.multivrs.space/invite/…"
            aria-label="Invitation link"
            className={cx(fieldClass, "min-w-0 flex-1")}
          />
          <Button type="submit" variant="outline" disabled={!link.trim()}>
            Open
          </Button>
        </div>
      </form>
    </div>
  );
}
