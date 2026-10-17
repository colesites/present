/**
 * The speeds a video can play at, 1 as recorded — within what the transport
 * takes (`src-tauri/src/services/playback.rs`, 0.5 to 2). The center pane's
 * speed control and the media panel's menu offer the same ones.
 */
export const VIDEO_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
