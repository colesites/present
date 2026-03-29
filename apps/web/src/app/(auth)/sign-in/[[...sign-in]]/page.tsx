import { SignIn } from "@clerk/nextjs";
import { LogIn } from "lucide-react";

interface SignInPageProps {
  searchParams: Promise<{
    source?: string;
    client?: string;
    flow?: string;
    next?: string | string[];
  }>;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const resolvedSearchParams = await searchParams;
  const isDesktopFlow =
    resolvedSearchParams.source === "desktop" ||
    resolvedSearchParams.client === "electron";
  const nextParam = resolvedSearchParams.next;
  const requestedNext = Array.isArray(nextParam) ? nextParam[0] : nextParam;
  const safeRedirectPath =
    typeof requestedNext === "string" && requestedNext.startsWith("/")
      ? requestedNext
      : "/dashboard";

  return (
    <div className="w-full max-w-lg">
      <div className="mb-4 space-y-2">
        <div className="flex items-center gap-2 text-xl font-semibold">
          <LogIn className="size-5 text-primary" />
          {isDesktopFlow ? "Sign in for desktop" : "Welcome back"}
        </div>
        <p className="text-sm text-muted-foreground">
          {isDesktopFlow
            ? "Finish sign-in here, then return to the Present desktop app."
            : "Sign in to your Present account to continue."}
        </p>
      </div>
      <SignIn
        routing="path"
        path="/sign-in"
        signUpUrl="/sign-up"
        forceRedirectUrl={safeRedirectPath}
      />
    </div>
  );
}
