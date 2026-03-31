import OrganizationSetupClient from "./OrganizationSetupClient";

interface OrganizationSetupPageProps {
  searchParams: Promise<{
    refreshToken?: string | string[];
    source?: string | string[];
    token?: string | string[];
  }>;
}

export default async function OrganizationSetupPage({
  searchParams,
}: OrganizationSetupPageProps) {
  const resolvedSearchParams = await searchParams;
  const refreshTokenParam = resolvedSearchParams.refreshToken;
  const sourceParam = resolvedSearchParams.source;
  const tokenParam = resolvedSearchParams.token;
  const refreshToken = Array.isArray(refreshTokenParam)
    ? (refreshTokenParam[0] ?? null)
    : (refreshTokenParam ?? null);
  const source = Array.isArray(sourceParam)
    ? (sourceParam[0] ?? null)
    : (sourceParam ?? null);
  const token = Array.isArray(tokenParam)
    ? (tokenParam[0] ?? null)
    : (tokenParam ?? null);

  return (
    <OrganizationSetupClient
      source={source}
      desktopRefreshToken={refreshToken}
      desktopToken={token}
    />
  );
}
