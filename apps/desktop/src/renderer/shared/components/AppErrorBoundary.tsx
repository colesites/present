"use client";

import * as React from "react";

/**
 * The last thing between a thrown error and a black window.
 *
 * React unmounts the whole tree when a render throws and nothing catches it,
 * which in this application means the operator is left looking at nothing in
 * the middle of a service. It happened for real: every org-scoped Convex query
 * started failing at once, and the window simply went blank with no way back
 * short of quitting.
 *
 * So this is not a nicety. Whatever went wrong, the operator gets a sentence
 * about it and a way to carry on, and the error is written to the same log the
 * Rust core keeps so there is something to read afterwards.
 */
type Props = { children: React.ReactNode };
type State = { error: Error | null };

export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // The same channel `window.onerror` uses, so a crash caught here is not
    // quieter than one that got past us.
    console.error("[Present] a window stopped rendering", error, info);
    try {
      window.electronAPI?.reportRendererError?.({
        source: "error-boundary",
        name: error.name,
        message: error.message,
        stack: `${error.stack ?? ""}\n${info.componentStack ?? ""}`,
      });
    } catch {
      // Reporting must never be the reason recovery fails.
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background p-8 text-center text-foreground">
        <div className="max-w-md space-y-2">
          <p className="text-sm font-semibold">Present stopped drawing this window</p>
          <p className="text-xs text-muted-foreground">
            The audience screen is unaffected — it is drawn by the core, not by
            this window. Reloading usually brings this one back.
          </p>
          <p className="break-words text-[11px] text-muted-foreground/80">
            {error.message}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="rounded-md border border-input px-3 py-1.5 text-xs font-medium hover:bg-secondary"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
