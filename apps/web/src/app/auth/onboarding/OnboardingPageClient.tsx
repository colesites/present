"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

const MAX_LOGO_FILE_SIZE = 4 * 1024 * 1024;
type LogoMode = "url" | "upload";
type OrganizationApi = typeof authClient.organization & {
  listOrganizations: () => Promise<{
    data?: Array<{
      id: string;
      name: string;
      slug: string;
      logo?: string | null;
      createdAt?: string | Date;
    }>;
  }>;
};

export default function OnboardingPageClient() {
  const router = useRouter();
  const { data: session, isPending: isSessionPending } = authClient.useSession();
  const organizationApi = authClient.organization as OrganizationApi;
  const [isLoading, setIsLoading] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [orgType, setOrgType] = useState("church");
  const [userRole, setUserRole] = useState("tech-director");
  const [logoMode, setLogoMode] = useState<LogoMode>("url");
  const [logoUrl, setLogoUrl] = useState("");
  const [uploadedLogo, setUploadedLogo] = useState<string | null>(null);
  const [uploadedLogoName, setUploadedLogoName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSessionPending && session?.session) {
      router.replace("/dashboard");
    }
  }, [isSessionPending, router, session]);

  const selectedLogo = useMemo(() => {
    if (logoMode === "upload") {
      return uploadedLogo ?? undefined;
    }

    const trimmedLogoUrl = logoUrl.trim();
    return trimmedLogoUrl.length > 0 ? trimmedLogoUrl : undefined;
  }, [logoMode, logoUrl, uploadedLogo]);

  const handleLogoUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (file.size > MAX_LOGO_FILE_SIZE) {
      setError("Logo upload must be 4MB or smaller.");
      event.target.value = "";
      return;
    }

    setError(null);
    setUploadedLogoName(file.name);

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        setUploadedLogo(result);
      } else {
        setError("Unable to read the selected logo file.");
      }
    };
    reader.onerror = () => {
      setError("Unable to read the selected logo file.");
    };
    reader.readAsDataURL(file);
  };

  const handleCreateOrganization = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const slug = orgName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)+/g, "");

      const { error: orgError } = await authClient.organization.create({
        name: orgName,
        slug,
        logo: selectedLogo,
      });

      if (orgError) {
        const errorMessage = orgError.message || "Failed to create organization";
        const isExistingOrgError =
          errorMessage.toLowerCase().includes("already exists") ||
          errorMessage.toLowerCase().includes("already taken");

        if (!isExistingOrgError) {
          setError(errorMessage);
          return;
        }
      }

      let syncOrgName = orgName;
      let syncLogo = selectedLogo;

      if (orgError) {
        const orgListResponse = await organizationApi.listOrganizations();
        const matchedOrganization =
          orgListResponse.data?.find(
            (organization) =>
              organization.slug === slug ||
              organization.name.toLowerCase() === orgName.trim().toLowerCase(),
          ) ?? orgListResponse.data?.[0];

        if (matchedOrganization) {
          syncOrgName = matchedOrganization.name;
          syncLogo = matchedOrganization.logo ?? syncLogo;
        }
      }

      const syncResponse = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          orgName: syncOrgName,
          logo: syncLogo,
        }),
      });

      if (!syncResponse.ok) {
        const payload = (await syncResponse.json().catch(() => null)) as
          | { error?: string }
          | null;

        setError(payload?.error || "Organization was created, but dashboard setup failed.");
        return;
      }

      router.push("/dashboard?setup=1");
    } catch (error) {
      console.error("Failed to create organization during onboarding:", error);
      setError(
        error instanceof Error ? error.message : "An unexpected error occurred during setup."
      );
    } finally {
      setIsLoading(false);
    }
  };


  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="mx-auto w-full max-w-lg space-y-8 rounded-2xl bg-card p-10 shadow-2xl border border-white/10">
        <div className="space-y-3 text-center">
          <h1 className="text-3xl font-bold tracking-tight">Create an Organization</h1>
          <p className="text-muted-foreground text-sm">
            Set up your church or organization so your team can collaborate in Present.
          </p>
        </div>
        
        {error && (
          <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive border border-destructive/20 text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleCreateOrganization} className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground/90" htmlFor="orgName">Organization Name</label>
            <input
              id="orgName"
              type="text"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              required
              className="w-full rounded-md border border-white/10 bg-background/50 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
              placeholder="e.g. Grace City Church"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground/90" htmlFor="orgType">Organization Type</label>
              <select
                id="orgType"
                value={orgType}
                onChange={(e) => setOrgType(e.target.value)}
                className="w-full rounded-md border border-white/10 bg-background/50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all text-foreground"
              >
                <option value="church">Church</option>
                <option value="school">School</option>
                <option value="business">Business</option>
                <option value="concert">Tour / Concert</option>
                <option value="other">Other</option>
              </select>
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground/90" htmlFor="userRole">Your Role</label>
              <select
                id="userRole"
                value={userRole}
                onChange={(e) => setUserRole(e.target.value)}
                className="w-full rounded-md border border-white/10 bg-background/50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all text-foreground"
              >
                <option value="tech-director">Tech Director</option>
                <option value="pastor">Pastor / Minister</option>
                <option value="volunteer">Volunteer</option>
                <option value="staff">Staff Member</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm font-medium text-foreground/90">Logo (Optional)</label>
              <div className="inline-flex rounded-md border border-white/10 bg-background/60 p-1 text-xs">
                <button
                  type="button"
                  onClick={() => setLogoMode("url")}
                  className={`rounded px-3 py-1 transition ${logoMode === "url" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Use URL
                </button>
                <button
                  type="button"
                  onClick={() => setLogoMode("upload")}
                  className={`rounded px-3 py-1 transition ${logoMode === "upload" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Upload
                </button>
              </div>
            </div>

            {logoMode === "url" ? (
              <input
                id="logoUrl"
                type="url"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                className="w-full rounded-md border border-white/10 bg-background/50 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                placeholder="https://example.com/logo.png"
              />
            ) : (
              <div className="space-y-3">
                <label
                  htmlFor="logoUpload"
                  className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-white/15 bg-background/50 px-4 py-6 text-center transition hover:border-primary/50"
                >
                  <span className="text-sm font-medium text-foreground">
                    Upload a logo image
                  </span>
                  <span className="mt-1 text-xs text-muted-foreground">
                    PNG, JPG, SVG, or WEBP up to 4MB
                  </span>
                  {uploadedLogoName ? (
                    <span className="mt-3 rounded-full bg-primary/15 px-3 py-1 text-xs text-primary">
                      {uploadedLogoName}
                    </span>
                  ) : null}
                </label>
                <input
                  id="logoUpload"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={handleLogoUpload}
                  className="hidden"
                />
              </div>
            )}

            {selectedLogo ? (
              <div className="rounded-xl border border-white/10 bg-background/60 p-4">
                <p className="mb-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Logo preview
                </p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={selectedLogo}
                  alt="Organization logo preview"
                  className="h-16 w-16 rounded-xl border border-white/10 object-cover"
                />
              </div>
            ) : null}
          </div>
          
          <button
            type="submit"
            disabled={isLoading || !orgName.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 text-sm font-bold text-primary-foreground shadow transition-all hover:bg-primary/90 disabled:opacity-50 disabled:hover:scale-100 hover:scale-[1.02]"
          >
            {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Create Organization"}
          </button>
        </form>

        <div className="pt-4 text-center">
          <button 
            type="button" 
            onClick={() => router.push("/dashboard")}
            className="text-sm text-muted-foreground hover:text-white transition-colors underline-offset-4 hover:underline"
          >
            Skip for now, go to dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
