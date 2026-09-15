/**
 * Start the React app once browser storage is ready (`web-storage.ts`).
 * Not a top-level `await`, so nothing depends on how the bundle is targeted.
 */
import { webStorageReady } from "./web-storage";
import { setSplashStatus } from "./window-ready";

setSplashStatus("Loading your settings");
void webStorageReady.then(() => {
  setSplashStatus("Opening the workspace");
  return import("../main/main-renderer");
});
