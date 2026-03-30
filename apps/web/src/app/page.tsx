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
  title: "Present | Cinematic Church Presentation & Stage Display",
  description: "Experience the next generation of church worship software. Dynamic lyrics, cloud synchronization, and stunning motion graphics for ministries like RCCG, Global Harvest, and elevation.",
  keywords: ["church software", "worship presentation", "lyrics projection", "stage display", "presenter software", "RCCG tech", "GHL present", "church tech Nigeria", "christian visuals"],
};

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary/30 scroll-smooth">
      <Navbar />

      <main className="flex flex-col">
        <Hero />
        <LogosWithBlurFlip />
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
