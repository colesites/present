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
  /**
   * Where to hand the session back.
   *
   * A `present://` link belongs to whichever Present is installed, which in
   * development is not the one being worked on. So a development desktop
   * opens a listener and asks to be handed the session there instead. Only a
   * loopback address, and only the path it listens on: this is a session
   * token, and anything else here would be somewhere to send it. And only in
   * development, because a packaged desktop never asks for it.
   */
  const comeBackTo = useMemo(() => {
    const value = searchParams.get("redirect");
    if (!value || process.env.NODE_ENV === "production") return null;
    try {
      const url = new URL(value);
      const isLoopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
      return url.protocol === "http:" && isLoopback && url.pathname === "/auth"
        ? url
        : null;
    } catch {
      return null;
    }
  }, [searchParams]);

  useEffect(() => {
    if (!sessionToken) {
      router.replace("/dashboard");
      return;
    }
    if (comeBackTo) {
      comeBackTo.searchParams.set("sessionToken", sessionToken);
      window.location.href = comeBackTo.toString();
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
  }, [router, sessionToken, comeBackTo]);

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
