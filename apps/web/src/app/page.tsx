import { Metadata } from "next";
import { Hero } from "@/components/home/Hero";
import { LogosWithBlurFlip } from "@/components/home/LogosWithBlurFlip";
import { Features } from "@/components/home/Features";
import { Testimonials } from "@/components/home/Testimonials";
import { Pricing } from "@/components/home/Pricing";
import { CallToAction } from "@/components/home/CallToAction";
import { Navbar, Footer } from "@/components/home/Layout";
import { HelpButton } from "@/components/help/HelpCenter";

export const metadata: Metadata = {
  // Overrides the layout's default for the home page only. Named ministries
  // were removed: naming a church as a user is a claim that needs their
  // agreement, and it narrowed the software to one kind of room.
  title: "Present | Presentation software for churches and live events",
  description:
    "Presentation software for churches, conferences and live events. Cloud libraries, real-time collaboration, instant scripture search, and a confidence view built for running something live.",
  keywords: [
    "Present app",
    "Present multivrs",
    "ProPresenter alternative",
    "presentation software",
    "church presentation software",
    "worship presentation software",
    "conference presentation software",
    "live event presentation",
    "lyrics projection",
    "scripture projection",
    "stage display",
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

      <HelpButton />

      <Footer />
    </div>
  );
}
