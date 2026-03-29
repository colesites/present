"use client";

import { useState } from "react";
import { useOrganization } from "@clerk/nextjs";
import { useMutation } from "convex/react";
import { api } from "../../../../../../../packages/backend/convex/_generated/api";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, MapPin, Users } from "lucide-react";

export default function OrganizationSetupClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { organization } = useOrganization();
  const updateOrganizationMetadata = useMutation(api.organizations.updateMetadata);
  const clerkOrgIdFromQuery = searchParams.get("clerkOrgId");
  const effectiveClerkOrgId = organization?.id ?? clerkOrgIdFromQuery;
  const effectiveOrgName = organization?.name ?? "your organization";

  const [orgType, setOrgType] = useState("church");
  const [location, setLocation] = useState("");
  const [userRole, setUserRole] = useState("tech-director");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!effectiveClerkOrgId) {
      setError("No organization found");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await updateOrganizationMetadata({
        clerkOrgId: effectiveClerkOrgId,
        orgType,
        location: location.trim() || undefined,
        userRole,
      });

      router.push("/dashboard");
    } catch (err) {
      console.error("Failed to update organization:", err);
      setError(err instanceof Error ? err.message : "Failed to update organization");
      setIsSubmitting(false);
    }
  };

  if (!effectiveClerkOrgId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="text-center">
          <p className="text-muted-foreground">Loading organization...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6 rounded-2xl bg-card p-8 shadow-2xl border border-white/10">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-bold tracking-tight">Complete Your Setup</h1>
          <p className="text-sm text-muted-foreground">
            Tell us more about {effectiveOrgName}
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive border border-destructive/20">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Organization Type */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Building2 className="h-4 w-4" />
              Organization Type
            </label>
            <select
              value={orgType}
              onChange={(e) => setOrgType(e.target.value)}
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

          {/* Location */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <MapPin className="h-4 w-4" />
              Location (Optional)
            </label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="City, State or Country"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {/* User Role */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Users className="h-4 w-4" />
              Your Role
            </label>
            <select
              value={userRole}
              onChange={(e) => setUserRole(e.target.value)}
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

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Saving..." : "Complete Setup"}
          </button>
        </form>
      </div>
    </div>
  );
}
