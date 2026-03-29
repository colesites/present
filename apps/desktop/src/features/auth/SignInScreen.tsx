import { useState } from "react";
import { Loader2, MonitorPlay } from "lucide-react";
import { Button } from "../../renderer/shared/components/ui/button";

export function SignInScreen() {
  const [isOpening, setIsOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openSignIn = async () => {
    if (!window.electronAPI?.beginAuthFlow || isOpening) {
      return;
    }

    setIsOpening(true);
    setError(null);
    try {
      const result = await window.electronAPI.beginAuthFlow();
      if (!result.ok) {
        setError(result.error ?? "Unable to start sign-in.");
      }
    } finally {
      setIsOpening(false);
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
          The elegant, high-performance media presentation engine for modern
          teams.
        </p>

        <div className="w-full px-6">
          {error ? (
            <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}
          <Button
            type="button"
            size="lg"
            className="w-full"
            onClick={() => void openSignIn()}
            disabled={isOpening}
          >
            {isOpening ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Continue in browser
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">
            Opens the web sign-in page to continue authentication.
          </p>
        </div>
      </div>
    </div>
  );
}
