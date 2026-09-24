import { Metadata } from "next";
import { Hero } from "@/components/home/Hero";
import { LogosWithBlurFlip } from "@/components/home/LogosWithBlurFlip";
import { Features } from "@/components/home/Features";
import { Testimonials } from "@/components/home/Testimonials";
import { Pricing } from "@/components/home/Pricing";
import { CallToAction } from "@/components/home/CallToAction";
import { Navbar, Footer } from "@/components/home/Layout";
import { MessageSquare } from "lucide-react";

export const metadata: Metadata = {
  // Overrides the layout's default for the home page only. Named ministries
  // were removed: naming a church as a user is a claim that needs their
  // agreement, and it narrowed the software to one kind of room.
  title: "Present — Presentation software for churches and live events",
  description:
    "Presentation software for churches, conferences and live events. Cloud libraries, real-time collaboration, instant scripture search, and a confidence view built for running something live.",
  keywords: [
    "presentation software",
    "church presentation software",
    "worship presentation software",
    "conference presentation software",
    "live event presentation",
    "ProPresenter alternative",
    "lyrics projection",
    "scripture projection",
    "stage display",
    "Present app",
    "Present multivrs",
  ],
};

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary/30 scroll-smooth">
      <Navbar />

      <main className="flex flex-col">
        <Hero />
        {/*
          "Trusted by churches around the world" and the logo wall, commented
          out rather than deleted: the claim needs churches who have agreed to
          be named, and the component is ready for when there are some.
        */}
        {/* <LogosWithBlurFlip /> */}
        <Features />
        <Testimonials />
        <Pricing />
        <CallToAction />
      </main>

      {/* Floating Chat Button */}
      <button className="fixed bottom-4 right-4 md:bottom-6 md:right-6 h-12 w-12 md:h-14 md:w-auto bg-white text-black font-semibold md:px-6 rounded-full shadow-[0_10px_40px_rgba(0,0,0,0.5)] hover:scale-105 transition-transform flex items-center justify-center md:gap-3 z-50">
        <MessageSquare className="w-5 h-5 md:w-5 md:h-5 shrink-0 text-primary" />
        <span className="hidden md:inline">How can we help?</span>
      </button>

      <Footer />
    </div>
  );
}
