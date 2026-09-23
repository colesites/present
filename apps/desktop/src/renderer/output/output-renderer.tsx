import '../main/index.css';

import * as React from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { OutputWindow } from "./OutputWindow";
import { WindowReadySignal } from "../tauri/window-ready";

const root = createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <OutputWindow />
      <WindowReadySignal />
    </ThemeProvider>
  </React.StrictMode>
);
