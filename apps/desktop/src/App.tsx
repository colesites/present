"use client";

import { Activity, useEffect, useRef, useState } from "react";
import { authClient } from "../../../packages/shared/src/auth";
import { SignInScreen } from "./features/auth/SignInScreen";
import { Loader2 } from "lucide-react";
import { AppHeader } from "./features/header";
import type { MediaPanelRef } from "./features/media";
import { useMediaFolders } from "./features/media/hooks";
import type { ScripturePanelRef } from "./features/scripture";
import type { ShowsPanelRef } from "./features/shows";
import {
  useOrganization,
  usePersistedUIState,
} from "./hooks";
import { useAppSettings } from "./hooks/useAppSettings";
import { SettingsScreen } from "./features/settings/components/SettingsScreen";
import { PresentContainer } from "./features/present/PresentContainer";
import type { ContentSource } from "./types";

type OneTimeTokenApi = {
  oneTimeToken: {
    verify: (input: { token: string }) => Promise<{
      error?: { message?: string } | null;
    }>;
  };
};

export default function Home() {
  const { data: sessionData, isPending: isLoading, error } = authClient.useSession();
  const isAuthenticated = !!sessionData?.session;
  const [showDiagnostic, setShowDiagnostic] = useState(false);
  const [isAuthHandoffPending, setIsAuthHandoffPending] = useState(false);
  const [authHandoffError, setAuthHandoffError] = useState<string | null>(null);
  const processedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const oneTimeTokenApi = authClient as typeof authClient & OneTimeTokenApi;

    const waitForSessionAfterHandoff = async () => {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const { data: refreshedSession } = await authClient.getSession();
        if (refreshedSession?.session) {
          return true;
        }

        await new Promise((resolve) => {
          setTimeout(resolve, 250);
        });
      }

      return false;
    };

    const processAuthToken = async (token: string) => {
      if (!token || processedTokenRef.current === token) {
        return;
      }

      processedTokenRef.current = token;
      setIsAuthHandoffPending(true);
      setAuthHandoffError(null);

      try {
        const { error: verifyError } = await oneTimeTokenApi.oneTimeToken.verify({
          token,
        });

        if (verifyError) {
          console.error("Desktop auth handoff failed:", verifyError.message);
          setAuthHandoffError(verifyError.message || "Desktop sign-in verification failed.");
          processedTokenRef.current = null;
          return;
        }

        const hasSession = await waitForSessionAfterHandoff();
        if (!hasSession) {
          setAuthHandoffError("Sign-in completed, but desktop session did not initialize. Please sign in again.");
          processedTokenRef.current = null;
          return;
        }

        (authClient as unknown as { $store?: { notify?: (signal: string) => void } })
          .$store?.notify?.("$sessionSignal");
      } catch (authError) {
        console.error("Desktop auth handoff failed:", authError);
        const message =
          authError instanceof Error
            ? authError.message
            : "Desktop sign-in handoff failed.";
        setAuthHandoffError(message);
        processedTokenRef.current = null;
      } finally {
        setIsAuthHandoffPending(false);
      }
    };

    const consumePendingToken = async () => {
      try {
        const token = await window.electronAPI.consumePendingAuthToken();
        if (token) {
          await processAuthToken(token);
        }
      } catch (consumeError) {
        console.error("Failed to consume pending auth token:", consumeError);
      }
    };

    window.electronAPI.onAuthCallback((token) => {
      void processAuthToken(token);
    });

    void consumePendingToken();
    const pollTimer = window.setInterval(() => {
      void consumePendingToken();
    }, 1500);

    return () => {
      window.clearInterval(pollTimer);
    };
  }, []);

  useEffect(() => {
    if (isLoading) {
      const timer = setTimeout(() => setShowDiagnostic(true), 8000);
      return () => {
        clearTimeout(timer);
        setShowDiagnostic(false);
      };
    }
  }, [isLoading]);

  // Organization & auth
  const { orgId } = useOrganization();

  // Root UI state
  const { viewMode, setViewMode, bottomTab, setBottomTab } = usePersistedUIState();
  const [contentSource, setContentSource] = useState<ContentSource>("my-creations");
  const [isAutopilotEnabled, setIsAutopilotEnabled] = useState(false);

  // Shared Data hooks (lifted for Settings vs Present toggling)
  const mediaState = useMediaFolders();
  const { folders, allMediaItems, selectMediaForOutput } = mediaState;
  const settings = useAppSettings({ folders, allMediaItems });

  const showsPanelRef = useRef<ShowsPanelRef>(null);
  const mediaPanelRef = useRef<MediaPanelRef>(null);
  const scripturePanelRef = useRef<ScripturePanelRef>(null);

  // Auth Gate: Ensure user is authenticated before loading Heavy UI/Convex
  if (isLoading) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-background p-6 text-center">
        <Loader2 className="mb-4 h-8 w-8 animate-spin text-primary" />
        {showDiagnostic && (
          <div className="max-w-md animate-in fade-in slide-in-from-bottom-4 duration-1000">
            <h2 className="mb-2 text-xl font-semibold text-foreground">Still loading...</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              The authentication service is taking longer than expected to initialize.
            </p>
            <div className="rounded-lg bg-secondary/50 p-4 text-left text-xs font-mono max-h-48 overflow-y-auto">
              <p className="mb-1 text-muted-foreground">// Diagnostic Info</p>
              <p>Origin: {typeof window !== "undefined" ? window.location.origin : "unknown"}</p>
              <p>Auth0 Domain: {process.env.AUTH0_DOMAIN ? "✅ Present" : "❌ MISSING"}</p>
              <p>Auth0 Client ID: {process.env.AUTH0_CLIENT_ID ? "✅ Present" : "❌ MISSING"}</p>
              {error && (
                <p className="mt-2 text-destructive">
                  ⚠️ Auth Error: {error.message}
                </p>
              )}
            </div>
          </div>
        )}
        {isAuthHandoffPending && (
          <p className="mt-3 text-sm text-muted-foreground">
            Completing sign-in from browser...
          </p>
        )}
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <SignInScreen
        isAuthHandoffPending={isAuthHandoffPending}
        handoffError={authHandoffError}
      />
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <AppHeader
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        contentSource={contentSource}
        onContentSourceChange={setContentSource}
        isAutopilotEnabled={isAutopilotEnabled}
        onToggleAutopilot={() => setIsAutopilotEnabled((prev) => !prev)}
      />

      <Activity mode={viewMode === "settings" ? "visible" : "hidden"}>
        <SettingsScreen
          {...settings}
          folders={folders}
          allMediaItems={allMediaItems}
          selectMediaForOutput={selectMediaForOutput}
        />
      </Activity>

      <Activity mode={viewMode === "settings" ? "hidden" : "visible"}>
        <PresentContainer
          orgId={orgId}
          viewMode={viewMode}
          bottomTab={bottomTab}
          setBottomTab={setBottomTab}
          contentSource={contentSource}
          mediaState={mediaState}
          settings={settings}
          showsPanelRef={showsPanelRef}
          mediaPanelRef={mediaPanelRef}
          scripturePanelRef={scripturePanelRef}
          isAutopilotEnabled={isAutopilotEnabled}
        />
      </Activity>
    </div>
  );
}
