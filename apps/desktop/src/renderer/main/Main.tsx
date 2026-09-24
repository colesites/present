import './index.css';

import * as React from "react";
import { createRoot } from "react-dom/client";
import App from './App';
import ConvexClientProvider from "../shared/providers/ConvexClientProvider";
import { QueryProvider } from "../shared/providers/QueryProvider";
import { ThemeProvider } from "next-themes";
import { Toaster } from "../shared/components/ui/sonner";
import { WindowReadySignal } from "../tauri/window-ready";
import { AppErrorBoundary } from "../shared/components/AppErrorBoundary";

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error("Root element not found");
}

const root = createRoot(rootElement);

root.render(
  <React.StrictMode>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <QueryProvider>
        <ConvexClientProvider>
          {/*
            Inside the providers, so a failing query is caught rather than
            taking the window with it, and the boundary can still be told to
            try again once the query recovers.
          */}
          <AppErrorBoundary>
            <App />
          </AppErrorBoundary>
        </ConvexClientProvider>
      </QueryProvider>
      <Toaster />
      <WindowReadySignal />
    </ThemeProvider>
  </React.StrictMode>
);
