"use client";

import { useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// Force dynamic rendering for this page
export const dynamic = 'force-dynamic';

export default function DesktopLaunchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get("token"), [searchParams]);

  useEffect(() => {
    if (!token) {
      router.replace("/dashboard");
      return;
    }
    window.location.href = `present://auth?token=${encodeURIComponent(token)}`;
    const closeTimeout = window.setTimeout(() => {
      window.close();
    }, 350);
    const fallbackTimeout = window.setTimeout(() => {
      router.replace("/dashboard?setup=1");
    }, 900);
    return () => {
      window.clearTimeout(closeTimeout);
      window.clearTimeout(fallbackTimeout);
    };
  }, [router, token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center">
        <h1 className="text-lg font-semibold">Opening Present Desktop...</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          If the app does not open automatically, return to dashboard and try again.
        </p>
      </div>
    </div>
  );
}
