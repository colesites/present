"use client";

import { useEffect, useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface SignupPageClientProps {
  setup?: boolean;
  nextPath?: string;
}

export default function SignupPageClient({ setup = false, nextPath }: SignupPageClientProps) {
  const router = useRouter();
  const { isAuthenticated, isLoading: isSessionPending } = useConvexAuth();
  const { signIn } = useAuthActions();
  
  const [isLoadingGoogle, setIsLoadingGoogle] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const dashboardPath = "/dashboard";

  const destinationPath = nextPath || dashboardPath;
  const authParams = new URLSearchParams();
  if (setup) {
    authParams.set("setup", "1");
  }
  if (nextPath) {
    authParams.set("next", nextPath);
  }
  const authQuery = authParams.toString() ? `?${authParams.toString()}` : "";

  useEffect(() => {
    if (!isSessionPending && isAuthenticated) {
      router.replace(destinationPath);
    }
  }, [destinationPath, isSessionPending, router, isAuthenticated]);

  const handleGoogleSignIn = async () => {
    setIsLoadingGoogle(true);
    setError(null);

    try {
      await signIn("google", { redirectTo: destinationPath });
    } catch (socialSignInError) {
      const message =
        socialSignInError instanceof Error
          ? socialSignInError.message
          : "Unable to start Google sign up. Please try again.";
      setError(message);
      setIsLoadingGoogle(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="mx-auto w-full max-w-sm space-y-6 rounded-2xl bg-card p-8 shadow-2xl border border-white/10">
        <div className="space-y-2 text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded bg-primary flex items-center justify-center font-bold text-white text-2xl shadow-[0_0_15px_rgba(var(--primary),0.5)]">
            P
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Create an account</h1>
          <p className="text-muted-foreground text-sm text-balance">Get started with Present today.</p>
        </div>
        
        {error && (
          <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive border border-destructive/20 text-center">
            {error}
          </div>
        )}

        <button
          className="flex w-full items-center justify-center gap-3 rounded-md bg-white px-4 py-2.5 text-sm font-medium text-black shadow-sm ring-1 ring-gray-300 hover:bg-gray-100 transition-colors disabled:opacity-50"
          onClick={handleGoogleSignIn}
          disabled={isLoadingGoogle}
        >
          {isLoadingGoogle ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
              <path
                d="M12.0003 4.75C13.7703 4.75 15.3553 5.36 16.6053 6.54998L20.0303 3.125C17.9502 1.19 15.2353 0 12.0003 0C7.31028 0 3.25527 2.69 1.28027 6.60998L5.27028 9.70498C6.21525 6.86 8.87028 4.75 12.0003 4.75Z"
                fill="#EA4335"
              />
              <path
                d="M23.49 12.275C23.49 11.49 23.415 10.73 23.3 10H12V14.51H18.47C18.18 15.99 17.34 17.25 16.08 18.1L19.945 21.1C22.2 19.01 23.49 15.92 23.49 12.275Z"
                fill="#4285F4"
              />
              <path
                d="M5.26498 14.2949C5.02498 13.5699 4.88501 12.7999 4.88501 11.9999C4.88501 11.1999 5.01998 10.4299 5.26498 9.7049L1.275 6.60986C0.46 8.22986 0 10.0599 0 11.9999C0 13.9399 0.46 15.7699 1.28 17.3899L5.26498 14.2949Z"
                fill="#FBBC05"
              />
              <path
                d="M12.0004 24.0001C15.2404 24.0001 17.9654 22.935 19.9454 21.095L16.0804 18.095C15.0054 18.82 13.6204 19.245 12.0004 19.245C8.8704 19.245 6.21537 17.135 5.26537 14.29L1.27539 17.385C3.25539 21.31 7.3104 24.0001 12.0004 24.0001Z"
                fill="#34A853"
              />
            </svg>
          )}
          Continue with Google
        </button>

        <p className="text-center text-sm text-muted-foreground mt-8">
          Already have an account?{" "}
          <Link href={`/auth/login${authQuery}`} className="text-primary hover:underline font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
