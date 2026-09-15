import './index.css';

import * as React from "react";
import { createRoot } from "react-dom/client";
import App from './App';
import ConvexClientProvider from "../shared/providers/ConvexClientProvider";
import { QueryProvider } from "../shared/providers/QueryProvider";
import { ThemeProvider } from "next-themes";
import { Toaster } from "../shared/components/ui/sonner";
import { WindowReadySignal } from "../tauri/window-ready";

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
          <App />
        </ConvexClientProvider>
      </QueryProvider>
      <Toaster />
      <WindowReadySignal />
    </ThemeProvider>
  </React.StrictMode>
);
