/**
 * Start the React app once browser storage is ready (`web-storage.ts`).
 * Not a top-level `await`, so nothing depends on how the bundle is targeted.
 */
import { webStorageReady } from "./web-storage";

void webStorageReady.then(() => import("../main/main-renderer"));
