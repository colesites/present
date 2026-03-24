import DesktopCallbackPageClient from "./DesktopCallbackPageClient";

interface DesktopCallbackPageProps {
  searchParams: Promise<{
    returnTo?: string;
  }>;
}

function sanitizeReturnTo(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value);
    const isAllowedHost = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    const isAllowedProtocol = parsed.protocol === "http:";

    if (!isAllowedHost || !isAllowedProtocol) {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

export default async function DesktopCallbackPage({
  searchParams,
}: DesktopCallbackPageProps) {
  const resolvedSearchParams = await searchParams;
  const returnTo = sanitizeReturnTo(resolvedSearchParams.returnTo);
  const nextPath = returnTo
    ? `/auth/desktop/callback?returnTo=${encodeURIComponent(returnTo)}`
    : "/dashboard";

  return <DesktopCallbackPageClient returnTo={returnTo} nextPath={nextPath} />;
}
