import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

interface DesktopCallbackPageProps {
  searchParams: Promise<{
    returnTo?: string;
  }>;
}

const getSafeReturnTo = (candidate: string | undefined): string | null => {
  if (!candidate) {
    return null;
  }

  try {
    const parsed = new URL(candidate);
    const isLocalHost =
      parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    const isHttp = parsed.protocol === "http:";
    return isLocalHost && isHttp ? parsed.toString() : null;
  } catch {
    return null;
  }
};

export default async function DesktopCallbackPage({
  searchParams,
}: DesktopCallbackPageProps) {
  const { returnTo } = await searchParams;
  const safeReturnTo = getSafeReturnTo(returnTo);
  const nextPath = `/auth/desktop/callback${safeReturnTo ? `?returnTo=${encodeURIComponent(safeReturnTo)}` : ""}`;
  const authState = await auth();
  const sessionId = authState.sessionId;

  if (!sessionId || !safeReturnTo) {
    await authState.redirectToSignIn({
      returnBackUrl: nextPath,
    });
    return;
  }

  const callbackUrl = new URL(safeReturnTo);
  callbackUrl.searchParams.set("token", sessionId);
  redirect(callbackUrl.toString());
}
