import fs from "fs/promises";
import path from "path";
import { app, crashReporter, type WebContents } from "electron";
import { redactDiagnosticText } from "../lib/diagnostic-redaction.mjs";

const ERROR_LOG_FILE_NAME = "present-errors.ndjson";
const ERROR_LOG_MAX_BYTES = 2 * 1024 * 1024;

export type PresentErrorEvent = {
  category: "main" | "renderer" | "child-process";
  message: string;
  name?: string;
  stack?: string;
  context?: Record<string, unknown>;
};

let initialized = false;
let writeQueue: Promise<void> = Promise.resolve();

const normalizeUnknownError = (error: unknown): Pick<PresentErrorEvent, "message" | "name" | "stack"> => {
  if (error instanceof Error) {
    return {
      message: redactDiagnosticText(error.message || "Unknown error"),
      name: redactDiagnosticText(error.name || "Error"),
      stack: error.stack ? redactDiagnosticText(error.stack) : undefined,
    };
  }

  return {
    message: redactDiagnosticText(typeof error === "string" ? error : String(error)),
  };
};

const getErrorLogPath = (): string =>
  path.join(app.getPath("userData"), "logs", ERROR_LOG_FILE_NAME);

const rotateLogIfNeeded = async (filePath: string): Promise<void> => {
  try {
    const stats = await fs.stat(filePath);
    if (stats.size < ERROR_LOG_MAX_BYTES) {
      return;
    }
    await fs.rename(filePath, `${filePath}.1`).catch(async () => {
      await fs.unlink(`${filePath}.1`).catch((): undefined => undefined);
      await fs.rename(filePath, `${filePath}.1`);
    });
  } catch {
    // Missing/unreadable log files are recreated on the next append.
  }
};

export const recordPresentError = (event: PresentErrorEvent): void => {
  writeQueue = writeQueue
    .then(async () => {
      const filePath = getErrorLogPath();
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await rotateLogIfNeeded(filePath);
      const entry = {
        appVersion: app.getVersion(),
        category: event.category,
        context: event.context ?? {},
        message: redactDiagnosticText(event.message),
        name: event.name ? redactDiagnosticText(event.name) : undefined,
        occurredAt: new Date().toISOString(),
        platform: process.platform,
        stack: event.stack ? redactDiagnosticText(event.stack) : undefined,
      };
      await fs.appendFile(filePath, `${JSON.stringify(entry)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
    })
    .catch((error) => {
      console.error("[Error Reporting] failed to write local diagnostic", error);
    });
};

const registerWebContentsDiagnostics = (contents: WebContents): void => {
  contents.on("render-process-gone", (_event, details) => {
    recordPresentError({
      category: "renderer",
      message: `Renderer process exited: ${details.reason}`,
      context: {
        exitCode: details.exitCode,
        reason: details.reason,
        type: contents.getType(),
      },
    });
  });

  contents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) {
      return;
    }
    recordPresentError({
      category: "renderer",
      message: errorDescription,
      context: {
        errorCode,
        url: redactDiagnosticText(validatedURL),
      },
    });
  });
};

export const initializeErrorReporting = (): void => {
  if (initialized) {
    return;
  }
  initialized = true;

  crashReporter.start({
    compress: true,
    submitURL: "",
    uploadToServer: false,
  });

  process.on("uncaughtException", (error) => {
    recordPresentError({ category: "main", ...normalizeUnknownError(error) });
    console.error("[Main] uncaught exception", error);
  });

  process.on("unhandledRejection", (reason) => {
    recordPresentError({ category: "main", ...normalizeUnknownError(reason) });
    console.error("[Main] unhandled rejection", reason);
  });

  app.on("web-contents-created", (_event, contents) => {
    registerWebContentsDiagnostics(contents);
  });

  app.on("child-process-gone", (_event, details) => {
    recordPresentError({
      category: "child-process",
      message: `Electron child process exited: ${details.reason}`,
      context: {
        exitCode: details.exitCode,
        name: details.name,
        reason: details.reason,
        serviceName: details.serviceName,
        type: details.type,
      },
    });
  });
};

export const recordRendererError = (payload: unknown): void => {
  if (!payload || typeof payload !== "object") {
    return;
  }
  const candidate = payload as Record<string, unknown>;
  const message = typeof candidate.message === "string" ? candidate.message : "Renderer error";
  recordPresentError({
    category: "renderer",
    message,
    name: typeof candidate.name === "string" ? candidate.name : undefined,
    stack: typeof candidate.stack === "string" ? candidate.stack : undefined,
    context: {
      source: typeof candidate.source === "string" ? candidate.source : "renderer",
    },
  });
};
