"use client";

import { useEffect, useState } from "react";
import {
  hasWorkspaceSynced,
  isOfflineDataRead,
  LOCAL_DATA_CHANGED_EVENT,
} from "../offline/localData";
import { useDesktopSessionStore } from "../store/desktopSession";

/**
 * Whether a workspace's list is still on its way, rather than empty.
 *
 * The lists read this machine's copy of the library, which takes a moment to
 * open; and a machine that has never held this workspace — the first sign-in
 * on it — waits for Convex. Until one or the other has answered, an empty list
 * is not "No services yet". It is loading, and says so.
 *
 * Offline, or signed out, nothing is coming, so an empty list is what it
 * looks like. A list with anything in it is never loading: what this machine
 * has is shown while Convex catches up.
 */
export function useFirstLoad(workspaceId: string, hasRows: boolean): boolean {
  const isSignedIn = useDesktopSessionStore(
    (state) => Boolean(state.sessionToken) && state.authStatus !== "unauthenticated",
  );
  const [, setVersion] = useState(0);

  useEffect(() => {
    const changed = () => setVersion((version) => version + 1);
    window.addEventListener(LOCAL_DATA_CHANGED_EVENT, changed);
    window.addEventListener("online", changed);
    window.addEventListener("offline", changed);
    return () => {
      window.removeEventListener(LOCAL_DATA_CHANGED_EVENT, changed);
      window.removeEventListener("online", changed);
      window.removeEventListener("offline", changed);
    };
  }, []);

  if (hasRows) return false;
  if (!isOfflineDataRead()) return true;
  const online = typeof navigator === "undefined" || navigator.onLine;
  return isSignedIn && online && !hasWorkspaceSynced(workspaceId);
}
