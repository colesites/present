import { MonitorPlay } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useState } from "react";

interface SignInScreenProps {
  isAuthHandoffPending?: boolean;
  handoffError?: string | null;
}

export function SignInScreen({
  isAuthHandoffPending = false,
  handoffError = null,
}: SignInScreenProps) {
  const [isOpeningBrowser, setIsOpeningBrowser] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isWaitingForBrowser = isOpeningBrowser && !handoffError;

  const handleSignIn = async () => {
    setIsOpeningBrowser(true);
    setError(null);

    const result = await window.electronAPI.beginAuthFlow();
    if (!result.ok) {
      setError(result.error || "Unable to open browser sign-in.");
      setIsOpeningBrowser(false);
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
          disabled={isWaitingForBrowser || isAuthHandoffPending}
          className="w-full text-md font-semibold h-12 shadow-lg hover:shadow-primary/25 transition-all ring-1 ring-primary/50"
        >
          {isWaitingForBrowser ? "Opening Browser..." : "Sign In"}
        </Button>
        {isWaitingForBrowser && !isAuthHandoffPending && (
          <p className="text-sm text-muted-foreground mt-2">
            Waiting for browser authentication to complete...
          </p>
        )}
        {isAuthHandoffPending && (
          <p className="text-sm text-muted-foreground mt-2">
            Completing sign-in from browser...
          </p>
        )}
        {error ? (
          <p className="text-sm text-destructive mt-2">{error}</p>
        ) : null}
        {handoffError ? (
          <p className="text-sm text-destructive mt-2">{handoffError}</p>
        ) : null}
      </div>
    </div>
  );
}
