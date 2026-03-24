"use client";

import { authClient } from "../../../../packages/shared/src/auth";

export function AuthControls() {
  const { data: sessionData } = authClient.useSession();
  const user = sessionData?.user;
  const isAuthenticated = !!sessionData?.session;

  if (!isAuthenticated || !user) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      {user.image ? (
        <img 
          src={user.image} 
          alt={user.name || "User"} 
          className="h-7 w-7 rounded-full"
        />
      ) : (
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/20 text-xs font-medium text-primary">
          {(user.name || user.email || "U").charAt(0).toUpperCase()}
        </div>
      )}
      <button
        type="button"
        onClick={async () => {
          await authClient.signOut();
          // Optional: handle local fast-refresh or UI reset
        }}
        className="rounded-md border border-input px-3 py-1 text-xs font-medium text-foreground transition hover:bg-secondary"
      >
        Sign out
      </button>
    </div>
  );
}
