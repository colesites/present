/**
 * The splash window (`services/splash.rs`): version and status, nothing else.
 * No React, so it draws the moment it loads.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import icon from "../../../src-tauri/icons/128x128@2x.png";

const byId = (id: string) => document.getElementById(id);

(byId("icon") as HTMLImageElement).src = icon;

const showStatus = (status: string) => {
  const element = byId("status");
  if (element) element.textContent = status;
};

void listen<string>("splash:status", (event) => showStatus(event.payload));
void invoke<string>("get_splash_status").then(showStatus).catch((): undefined => undefined);
void invoke<{ version: string }>("get_app_info")
  .then((info) => {
    const element = byId("version");
    if (element) element.textContent = `Version ${info.version}`;
  })
  .catch((): undefined => undefined);
