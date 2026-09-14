import { useEffect, useState } from "react";

type Surface = { enabled: boolean; presenting: boolean; supported: boolean };

type SurfaceApi = {
  getNativeOutputSurface?: () => Promise<Surface>;
  setNativeOutputSurface?: (enabled: boolean) => Promise<Surface>;
};

/**
 * The opt-in for drawing the audience screen natively (Stage 6, ADR-001).
 *
 * Renders nothing unless the shell offers it — the Electron build does not —
 * and says plainly that it is off by default and why.
 */
export function NativeOutputSurfaceToggle() {
  const api = window.electronAPI as unknown as SurfaceApi | undefined;
  const [surface, setSurface] = useState<Surface | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api?.getNativeOutputSurface) return;
    let cancelled = false;
    void api
      .getNativeOutputSurface()
      .then((next) => {
        if (!cancelled) setSurface(next);
      })
      .catch(() => {
        if (!cancelled) setError("Unable to read the audience screen setting");
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  if (!api?.getNativeOutputSurface || !api.setNativeOutputSurface || !surface?.supported) {
    return null;
  }

  const toggle = (enabled: boolean) => {
    setError(null);
    void api
      .setNativeOutputSurface?.(enabled)
      .then(setSurface)
      .catch(() => setError("Unable to change the audience screen setting"));
  };

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Audience screen
      </h3>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={surface.enabled}
          onChange={(event) => toggle(event.target.checked)}
          className="accent-primary"
        />
        Draw the audience screen natively (experimental)
      </label>
      <p className="text-[11px] text-muted-foreground">
        Off by default. When on, the audience screen is drawn by the same engine as the
        NDI stream. If it cannot draw, the screen falls back to the standard output on its
        own. On a Retina screen, or a 4K screen set to a scaled resolution, text is softer
        than the standard output. Try it before a service, not during one.
        {surface.enabled ? ` Status: ${surface.presenting ? "drawing natively" : "standard output"}.` : ""}
      </p>
      {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
    </section>
  );
}
