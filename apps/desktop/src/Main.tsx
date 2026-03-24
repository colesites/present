import './index.css';

import * as React from "react";
import { createRoot } from "react-dom/client";
import App from './App';
import ConvexClientProvider from "./providers/ConvexClientProvider";
import { QueryProvider } from "./providers/QueryProvider";
import { ThemeProvider } from "next-themes";
import { Toaster } from "./components/ui/sonner";

const root = createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <QueryProvider>
        <ConvexClientProvider>
          <App />
        </ConvexClientProvider>
      </QueryProvider>
      <Toaster />
    </ThemeProvider>
  </React.StrictMode>
);