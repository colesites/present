export declare const ERROR_LOG_DIRECTORY: "logs";
export declare const ERROR_LOG_FILE_NAME: "present-errors.ndjson";
export declare const ERROR_LOG_MAX_BYTES: number;

export type PresentErrorEvent = {
  category: "main" | "renderer" | "child-process";
  message: string;
  name?: string;
  stack?: string;
  context?: Record<string, unknown>;
};

export declare function errorLogLine(
  event: PresentErrorEvent,
  at: { appVersion: string; platform: string; occurredAt: Date },
): string;
export declare function shouldRotateErrorLog(sizeBytes: number): boolean;
export declare function rendererErrorEvent(payload: unknown): PresentErrorEvent | null;
