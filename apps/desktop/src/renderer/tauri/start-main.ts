/**
 * Start the React app once browser storage is ready (`web-storage.ts`).
 * Not a top-level `await`, so nothing depends on how the bundle is targeted.
 */
import { markStartup } from "../shared/lib/startup-timeline";
import { webStorageReady } from "./web-storage";
import { setSplashStatus } from "./window-ready";

markStartup("script-started");
setSplashStatus("Loading your settings");
void webStorageReady.then(() => {
  markStartup("settings-ready");
  setSplashStatus("Opening the workspace");
  // This machine's library is read while the workspace loads, not after it
  // has drawn. It used to start from the first render of the lists, so they
  // were drawn empty and filled up to a second later — on every launch, with
  // everything they needed already on the disk.
  void import("../shared/offline/localData").then(({ whenOfflineDataReady }) =>
    whenOfflineDataReady(),
  );
  return import("../main/main-renderer").then((renderer) => {
    markStartup("workspace-code-loaded");
    return renderer;
  });
});
