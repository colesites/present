import { useCallback, useEffect, useState } from "react";

import {
  SettingsBlock,
  SettingsGroup,
  SettingsNumber,
  SettingsRow,
  SettingsSwitch,
} from "./settings-ui";
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
      <SettingsGroup title="Phone remote">
        <SettingsRow
          label="Phone remote"
          description={failed ? "Unable to read the remote settings." : "Reading the remote settings…"}
        />
      </SettingsGroup>
    );
  }

  const { config, url, qrSvg, error } = status;
  const problem = failed ? "Unable to save the remote settings." : error;

  return (
    <SettingsGroup
      title="Phone remote"
      description="Move the slides from a phone on the same network. It works without internet."
    >
      <SettingsRow
        label="Phone remote"
        description={
          problem ? (
            <span className="text-red-400">{problem}</span>
          ) : config.enabled ? (
            "On. Scan the code below to join; it changes each time the remote starts."
          ) : (
            "Off."
          )
        }
      >
        <SettingsSwitch
          label="Phone remote"
          checked={config.enabled}
          onChange={(enabled) => save({ ...config, enabled })}
        />
      </SettingsRow>
      <SettingsRow label="Port" description="Change it only if something else on this computer uses it.">
        <SettingsNumber
          label="Phone remote port"
          value={config.port}
          min={1}
          max={65535}
          onChange={(port) => save({ ...config, port })}
        />
      </SettingsRow>
      {config.enabled && url ? (
        <SettingsBlock className="flex items-center gap-4">
          {qrSvg ? (
            <div
              className="h-[120px] w-[120px] flex-none overflow-hidden rounded-lg bg-white p-1.5"
              // The code is an SVG the core drew; it comes from no network.
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
          ) : null}
          <div className="min-w-0 space-y-1.5">
            <p className="text-[12px] text-muted-foreground">Scan it, or type this address:</p>
            <code className="block select-all break-all rounded-md bg-background/60 px-2 py-1 text-[12px] text-foreground">
              {url}
            </code>
            <p className="text-[12px] leading-[18px] text-muted-foreground">
              Anyone with this address can move the slides, so keep the code on the operator&apos;s screen.
            </p>
          </div>
        </SettingsBlock>
      ) : null}
    </SettingsGroup>
  );
}
