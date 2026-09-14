const reportRendererFailure = (error: unknown, source: string): void => {
  const normalized =
    error instanceof Error
      ? { message: error.message, name: error.name, stack: error.stack }
      : { message: typeof error === 'string' ? error : String(error) };
  window.electronAPI?.reportRendererError?.({
    ...normalized,
    source,
  });
};

window.addEventListener('error', (event) => {
  reportRendererFailure(event.error ?? event.message, 'window.error');
});

window.addEventListener('unhandledrejection', (event) => {
  reportRendererFailure(event.reason, 'window.unhandledrejection');
});

void import('./Main').catch((error) => {
  reportRendererFailure(error, 'renderer.bootstrap');
  throw error;
});

// A module, so the Tauri entry (`renderer/tauri/start-main.ts`) can import it
// once browser storage is ready. Nothing is exported.
export {};
