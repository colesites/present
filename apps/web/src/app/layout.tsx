import type { Metadata } from "next";
import { Outfit, Inter, Geist } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { ClerkProvider } from "@clerk/nextjs";
import ConvexClientProvider from "@/components/ConvexClientProvider";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // "Present" alone is an English word competing with millions of pages, so
  // the title says what the thing is as well as what it is called. The
  // template gives every other page the same suffix without repeating it.
  title: {
    default: "Present — Presentation software for churches and live events",
    template: "%s — Present",
  },
  description:
    "Present is presentation software for churches, conferences and live events. Cloud libraries, real-time collaboration, instant scripture search, and a confidence view built for running a service live.",
  applicationName: "Present",
  keywords: [
    "presentation software",
    "church presentation software",
    "worship presentation software",
    "live event presentation",
    "ProPresenter alternative",
    "lyrics projection",
    "scripture projection",
    "Present app",
    "Present multivrs",
  ],
  openGraph: {
    title: "Present — Presentation software for churches and live events",
    description:
      "Cloud libraries, real-time collaboration, instant scripture search, and a confidence view built for running a service live.",
    siteName: "Present",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html
        lang="en"
        className={cn("h-full", "antialiased", outfit.variable, inter.variable, "font-sans", geist.variable)}
      >
        <body className="min-h-full flex flex-col">
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}

