import OrganizationSetupClient from "./OrganizationSetupClient";

interface OrganizationSetupPageProps {
  searchParams: Promise<{
    source?: string | string[];
    token?: string | string[];
  }>;
}

export default async function OrganizationSetupPage({
  searchParams,
}: OrganizationSetupPageProps) {
  const resolvedSearchParams = await searchParams;
  const sourceParam = resolvedSearchParams.source;
  const tokenParam = resolvedSearchParams.token;
  const source = Array.isArray(sourceParam)
    ? (sourceParam[0] ?? null)
    : (sourceParam ?? null);
  const token = Array.isArray(tokenParam)
    ? (tokenParam[0] ?? null)
    : (tokenParam ?? null);

  return <OrganizationSetupClient source={source} desktopToken={token} />;
}
