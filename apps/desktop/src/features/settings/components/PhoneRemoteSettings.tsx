import { useCallback, useEffect, useState } from "react";

import {
  getRemoteStatus,
  setRemoteSettings,
  type RemoteStatus,
} from "../../../renderer/tauri/remote";

/**
 * The phone remote: a page served on the church's own network, joined by
 * scanning the code.
 *
 * Off until it is switched on, and the code carries a token that changes every
 * time it starts — so last Sunday's photograph of the screen is not a way in.
 */
export function PhoneRemoteSettings() {
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void getRemoteStatus()
      .then(setStatus)
      .catch(() => setFailed(true));
  }, []);

  const save = useCallback((config: RemoteStatus["config"]) => {
    setFailed(false);
    void setRemoteSettings(config)
      .then(setStatus)
      .catch(() => setFailed(true));
  }, []);

  if (!status) {
    return (
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Phone remote
        </h3>
        <p className="text-[11px] text-muted-foreground">
          {failed ? "Unable to read the remote settings" : "Reading the remote settings…"}
        </p>
      </section>
    );
  }

  const { config, url, qrSvg, error } = status;

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Phone remote
        </h3>
        <p className="text-[11px] text-muted-foreground">
          Move the slides from a phone on the same network. Scan the code to join; it
          works without internet, and the code changes each time the remote starts.
        </p>
      </div>

      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          className="accent-primary"
          checked={config.enabled}
          onChange={(event) => save({ ...config, enabled: event.target.checked })}
        />
        <span>Phone remote</span>
      </label>

      <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="w-20">Port</span>
        <input
          type="number"
          min={1}
          max={65535}
          className="w-24 rounded border border-border bg-background px-2 py-1 text-xs"
          value={config.port}
          onChange={(event) => {
            const port = Number(event.target.value);
            if (Number.isInteger(port) && port > 0 && port < 65536) {
              save({ ...config, port });
            }
          }}
        />
      </label>

      {failed ? (
        <p className="text-[11px] text-destructive">Unable to save the remote settings</p>
      ) : null}
      {error ? <p className="text-[11px] text-destructive">{error}</p> : null}

      {config.enabled && url ? (
        <div className="flex items-start gap-3">
          {qrSvg ? (
            <div
              className="h-[132px] w-[132px] shrink-0 overflow-hidden rounded bg-white p-1"
              // The code is an SVG the core drew; it comes from no network.
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
          ) : null}
          <div className="space-y-1">
            <p className="text-[11px] text-muted-foreground">Scan, or type this in:</p>
            <code className="block break-all text-[11px]">{url}</code>
            <p className="text-[11px] text-muted-foreground">
              Anyone with this address can move the slides, so keep the code on the
              operator&apos;s screen.
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
