import { Hero } from "@/components/home/Hero";
import { FeatureFocus } from "@/components/home/FeatureFocus";
import { FeaturesGrid } from "@/components/home/FeaturesGrid";
import { CallToAction } from "@/components/home/CallToAction";
import { Navbar, Footer } from "@/components/home/Layout";
import { MessageSquare } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary/30">
      <Navbar />

      <main className="flex flex-col">
        <Hero />
        <FeatureFocus />
        <FeaturesGrid />
        <CallToAction />
      </main>

      {/* Floating Chat Button */}
      <button className="fixed bottom-6 right-6 h-14 bg-white text-black font-semibold px-6 rounded-full shadow-[0_10px_40px_rgba(0,0,0,0.5)] hover:scale-105 transition-transform flex items-center gap-3 z-50">
        <MessageSquare className="w-5 h-5 text-primary" />
        How can we help?
      </button>

      <Footer />
    </div>
  );
}
