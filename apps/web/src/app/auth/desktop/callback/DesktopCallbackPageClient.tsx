"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useConvexAuth } from "convex/react";
import { useMutation } from "convex/react";
import { api } from "@present/backend/convex/_generated/api";

interface DesktopCallbackPageClientProps {
  returnTo: string | null;
  nextPath: string;
}

export default function DesktopCallbackPageClient({
  returnTo,
  nextPath,
}: DesktopCallbackPageClientProps) {
  const router = useRouter();
  const { isAuthenticated, isLoading: isSessionPending } = useConvexAuth();
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!returnTo || isSessionPending) {
      return;
    }

    if (!isAuthenticated) {
      router.replace(`/auth/login?next=${encodeURIComponent(nextPath)}`);
    }
  }, [isSessionPending, nextPath, returnTo, router, isAuthenticated]);

  useEffect(() => {
    if (!returnTo || isSessionPending || !isAuthenticated) {
      return;
    }

    let cancelled = false;

    const handoff = async () => {
      setError(null);

      try {
        // For now, we'll use a simple approach: redirect with a success flag
        // The desktop app will use its existing Convex Auth session
        const target = new URL(returnTo);
        target.searchParams.set("success", "true");
        window.location.replace(target.toString());
      } catch (handoffError) {
        if (cancelled) {
          return;
        }

        const message =
          handoffError instanceof Error
            ? handoffError.message
            : "Session handoff failed. Please retry.";
        setError(message);
      }
    };

    void handoff();

    return () => {
      cancelled = true;
    };
  }, [attempt, isSessionPending, returnTo, isAuthenticated]);

  if (!returnTo) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-card p-6 text-center">
          <h1 className="text-2xl font-semibold">Invalid desktop callback</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            The desktop callback URL is missing or invalid. Start sign-in again from the desktop app.
          </p>
          <div className="mt-6">
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Go to dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-card p-6 text-center">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
        <h1 className="mt-4 text-2xl font-semibold">Signing in desktop app</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Keep this tab open. We are securely handing your session to the desktop app.
        </p>

        {error ? (
          <div className="mt-5">
            <p className="text-sm text-destructive">{error}</p>
            <button
              type="button"
              onClick={() => {
                setAttempt((current) => current + 1);
              }}
              className="mt-3 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Retry handoff
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
