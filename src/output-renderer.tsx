import './index.css';

import * as React from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { OutputWindow } from "./OutputWindow";

const root = createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <OutputWindow />
    </ThemeProvider>
  </React.StrictMode>
);
