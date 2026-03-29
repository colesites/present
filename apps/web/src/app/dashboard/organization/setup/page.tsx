import OrganizationSetupClient from "./OrganizationSetupClient";

interface OrganizationSetupPageProps {
  searchParams: Promise<{
    clerkOrgId?: string | string[];
  }>;
}

export default async function OrganizationSetupPage({
  searchParams,
}: OrganizationSetupPageProps) {
  const resolvedSearchParams = await searchParams;
  const clerkOrgIdParam = resolvedSearchParams.clerkOrgId;
  const clerkOrgIdFromQuery = Array.isArray(clerkOrgIdParam)
    ? (clerkOrgIdParam[0] ?? null)
    : (clerkOrgIdParam ?? null);

  return <OrganizationSetupClient clerkOrgIdFromQuery={clerkOrgIdFromQuery} />;
}
