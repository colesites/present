"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { authClient } from "@/lib/auth-client";

interface DesktopCallbackPageClientProps {
  returnTo: string | null;
  nextPath: string;
}

export default function DesktopCallbackPageClient({
  returnTo,
  nextPath,
}: DesktopCallbackPageClientProps) {
  const router = useRouter();
  const { data: session, isPending: isSessionPending } = authClient.useSession();
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!returnTo || isSessionPending) {
      return;
    }

    if (!session?.session) {
      router.replace(`/auth/login?next=${encodeURIComponent(nextPath)}`);
    }
  }, [isSessionPending, nextPath, returnTo, router, session]);

  useEffect(() => {
    if (!returnTo || isSessionPending || !session?.session) {
      return;
    }

    let cancelled = false;

    const handoff = async () => {
      setError(null);

      try {
        const { data, error: tokenError } = await authClient.oneTimeToken.generate();
        if (cancelled) {
          return;
        }

        const token = data?.token;
        if (tokenError || !token) {
          setError(tokenError?.message || "Unable to hand off the session to the desktop app.");
          return;
        }

        const target = new URL(returnTo);
        target.searchParams.set("token", token);
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
  }, [attempt, isSessionPending, returnTo, session]);

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
