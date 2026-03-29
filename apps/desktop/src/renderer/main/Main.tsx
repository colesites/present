import './index.css';

import * as React from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import App from './App';
import ConvexClientProvider from "../shared/providers/ConvexClientProvider";
import { QueryProvider } from "../shared/providers/QueryProvider";
import { ThemeProvider } from "next-themes";
import { Toaster } from "../shared/components/ui/sonner";

const clerkPublishableKey = process.env.CLERK_PUBLISHABLE_KEY;

if (!clerkPublishableKey) {
  throw new Error("Missing CLERK_PUBLISHABLE_KEY in environment");
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error("Root element not found");
}

const root = createRoot(rootElement);

root.render(
  <React.StrictMode>
    <ClerkProvider 
      publishableKey={clerkPublishableKey}
      appearance={{
        baseTheme: undefined,
        variables: {
          colorBackground: '#111111',
          colorText: '#ffffff',
        }
      }}
      isSatellite={false}
      domain={undefined}
    >
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
        <QueryProvider>
          <ConvexClientProvider>
            <App />
          </ConvexClientProvider>
        </QueryProvider>
        <Toaster />
      </ThemeProvider>
    </ClerkProvider>
  </React.StrictMode>
);
