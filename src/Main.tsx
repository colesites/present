import './index.css';

import * as React from "react";
import { createRoot } from "react-dom/client";
import App from './App';
import ConvexClientProvider from "./providers/ConvexClientProvider";
import { QueryProvider } from "./providers/QueryProvider";
import { ClerkProvider } from "@clerk/clerk-react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "./components/ui/sonner";

const publishableKey = process.env.CLERK_PUBLISHABLE_KEY;

if (!publishableKey) {
  console.warn("Missing Publishable Key for Clerk");
}

const root = createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <ClerkProvider publishableKey={publishableKey || ""} signUpFallbackRedirectUrl={window.location.href} signInFallbackRedirectUrl={window.location.href} afterSignOutUrl={window.location.href}>
        <QueryProvider>
          <ConvexClientProvider>
            <App />
          </ConvexClientProvider>
        </QueryProvider>
      </ClerkProvider>
      <Toaster />
    </ThemeProvider>
  </React.StrictMode>
);