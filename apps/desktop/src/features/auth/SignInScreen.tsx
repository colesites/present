import { useMemo, useState } from "react";
import { ExternalLink, Loader2, MonitorPlay } from "lucide-react";
import { Button } from "../../renderer/shared/components/ui/button";

export function SignInScreen() {
  const [isOpening, setIsOpening] = useState(false);

  const signInUrl = useMemo(() => {
    const baseUrl =
      process.env.WEB_APP_URL ||
      (process.env.NODE_ENV === "development"
        ? "http://localhost:3001"
        : "https://present-gha.vercel.app");

    const url = new URL("/sign-in", baseUrl);
    url.searchParams.set("source", "desktop");
    url.searchParams.set("client", "electron");
    url.searchParams.set("flow", "external-browser");
    return url.toString();
  }, []);

  const openSignIn = async () => {
    if (!window.electronAPI?.openExternalBrowser || isOpening) {
      return;
    }

    setIsOpening(true);
    try {
      await window.electronAPI.openExternalBrowser(signInUrl);
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
          <Button
            type="button"
            size="lg"
            className="w-full"
            onClick={() => void openSignIn()}
            disabled={isOpening}
          >
            {isOpening ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ExternalLink className="h-4 w-4" />
            )}
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
