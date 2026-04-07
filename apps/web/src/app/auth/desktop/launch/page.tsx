"use client";

import { Suspense, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function DesktopLaunchContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionToken = useMemo(
    () => searchParams.get("sessionToken"),
    [searchParams]
  );

  useEffect(() => {
    if (!sessionToken) {
      router.replace("/dashboard");
      return;
    }
    window.location.href = `present://auth?sessionToken=${encodeURIComponent(
      sessionToken
    )}`;
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
  }, [router, sessionToken]);

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

export default function DesktopLaunchPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center">
          <h1 className="text-lg font-semibold">Loading...</h1>
        </div>
      </div>
    }>
      <DesktopLaunchContent />
    </Suspense>
  );
}
