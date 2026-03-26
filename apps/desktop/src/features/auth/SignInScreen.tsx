import { MonitorPlay } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useState } from "react";

interface SignInScreenProps {
  signIn: (provider: string) => Promise<{ signingIn: boolean; redirect?: URL }>;
}

export function SignInScreen({ signIn }: SignInScreenProps) {
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setIsSigningIn(true);
    setError(null);

    try {
      // Use Convex Auth's Google OAuth directly
      await signIn("google");
    } catch (authError) {
      const message =
        authError instanceof Error
          ? authError.message
          : "Unable to sign in. Please try again.";
      setError(message);
      setIsSigningIn(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground animate-in fade-in duration-500">
      <div className="flex flex-col items-center gap-6 max-w-md text-center">
        <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-primary/10 text-primary mb-2 shadow-inner ring-1 ring-primary/20">
          <MonitorPlay size={48} className="drop-shadow-sm" />
        </div>
        
        <h1 className="text-5xl font-extrabold tracking-tight bg-linear-to-br from-foreground to-foreground/70 bg-clip-text text-transparent">
          Present
        </h1>
        
        <p className="text-muted-foreground text-lg px-6 leading-relaxed mb-6">
          The elegant, high-performance media presentation engine for modern teams.
        </p>

        <Button 
          size="lg" 
          onClick={handleSignIn}
          disabled={isSigningIn}
          className="w-full text-md font-semibold h-12 shadow-lg hover:shadow-primary/25 transition-all ring-1 ring-primary/50"
        >
          {isSigningIn ? "Opening Browser..." : "Sign In with Google"}
        </Button>
        {isSigningIn && (
          <p className="text-sm text-muted-foreground mt-2">
            Complete sign-in in your browser...
          </p>
        )}
        {error && (
          <p className="text-sm text-destructive mt-2">{error}</p>
        )}
      </div>
    </div>
  );
}
