import OrganizationSetupClient from "./OrganizationSetupClient";

interface OrganizationSetupPageProps {
  searchParams: Promise<{
    sessionToken?: string | string[];
    source?: string | string[];
    redirect?: string | string[];
  }>;
}

export default async function OrganizationSetupPage({
  searchParams,
}: OrganizationSetupPageProps) {
  const resolvedSearchParams = await searchParams;
  const sessionTokenParam = resolvedSearchParams.sessionToken;
  const sourceParam = resolvedSearchParams.source;
  const sessionToken = Array.isArray(sessionTokenParam)
    ? (sessionTokenParam[0] ?? null)
    : (sessionTokenParam ?? null);
  const source = Array.isArray(sourceParam)
    ? (sourceParam[0] ?? null)
    : (sourceParam ?? null);
  const redirectParam = resolvedSearchParams.redirect;
  const comeBackTo = Array.isArray(redirectParam)
    ? (redirectParam[0] ?? null)
    : (redirectParam ?? null);

  return (
    <OrganizationSetupClient
      source={source}
      desktopSessionToken={sessionToken}
      desktopComeBackTo={comeBackTo}
    />
  );
}
