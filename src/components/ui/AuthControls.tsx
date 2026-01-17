"use client";

import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";

export function AuthControls() {
  return (
    <>
      <SignedIn>
        <UserButton
          appearance={{ elements: { userButtonAvatarBox: "h-7 w-7" } }}
        />
      </SignedIn>
      <SignedOut>
        <SignInButton mode="modal">
          <button
            type="button"
            className="rounded-md border border-input px-3 py-1 text-xs font-medium text-foreground transition hover:bg-secondary"
          >
            Sign in
          </button>
        </SignInButton>
      </SignedOut>
    </>
  );
}
