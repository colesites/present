/**
 * Start the audience window once browser storage is ready (`web-storage.ts`).
 * It never waits longer than that module's timeout.
 */
import { webStorageReady } from "./web-storage";

void webStorageReady.then(() => import("../output/output-renderer"));
