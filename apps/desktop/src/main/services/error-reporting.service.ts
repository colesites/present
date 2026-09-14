import fs from "fs/promises";
import path from "path";
import { app, crashReporter, type WebContents } from "electron";
import { redactDiagnosticText } from "../lib/diagnostic-redaction.mjs";
import {
  ERROR_LOG_DIRECTORY,
  ERROR_LOG_FILE_NAME,
  errorLogLine,
  rendererErrorEvent,
  shouldRotateErrorLog,
  type PresentErrorEvent,
} from "../lib/error-log.mjs";

export type { PresentErrorEvent };

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
  path.join(app.getPath("userData"), ERROR_LOG_DIRECTORY, ERROR_LOG_FILE_NAME);

const rotateLogIfNeeded = async (filePath: string): Promise<void> => {
  try {
    const stats = await fs.stat(filePath);
    if (!shouldRotateErrorLog(stats.size)) {
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
      const line = errorLogLine(event, {
        appVersion: app.getVersion(),
        platform: process.platform,
        occurredAt: new Date(),
      });
      await fs.appendFile(filePath, `${line}\n`, {
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
  const event = rendererErrorEvent(payload);
  if (event) {
    recordPresentError(event);
  }
};
