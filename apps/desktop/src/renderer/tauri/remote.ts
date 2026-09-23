/**
 * The phone remote, as the settings screen sees it.
 *
 * The core runs the server and holds the token (`services/remote`); this is
 * the switch, the address and the code to scan.
 */

import { invoke } from "@tauri-apps/api/core";

export type RemoteConfig = { enabled: boolean; port: number };

export type RemoteStatus = {
  config: RemoteConfig;
  /** The address to scan or type, token included, while it is running. */
  url: string | null;
  /** That address as an SVG. */
  qrSvg: string | null;
  error: string | null;
};

export const getRemoteStatus = () => invoke<RemoteStatus>("get_remote_status");

export const setRemoteSettings = (config: RemoteConfig) =>
  invoke<RemoteStatus>("set_remote_settings", { config });
