import Link from "next/link";
import { ArrowRight, Download } from "lucide-react";

export function FeatureFocus() {
  return (
    <section className="py-24 px-6 lg:px-12 bg-card/30 border-y border-white/5 relative z-20 bg-background">
      <div className="container mx-auto">
        <div className="text-center max-w-3xl mx-auto mb-16 space-y-4">
          <h2 className="text-4xl font-bold tracking-tight">Powerful tools to help tell your story</h2>
          <p className="text-lg text-muted-foreground">
            Designed to handle the most demanding productions, our software is user-friendly, making it perfect for volunteers and staff.
          </p>
          <p className="text-primary font-medium hover:underline cursor-pointer">
            Download any of our products for free and see for yourself!
          </p>
        </div>

        {/* Large Product Card */}
        <div className="grid lg:grid-cols-2 rounded-3xl overflow-hidden bg-card border border-white/10 shadow-2xl relative">
          <div className="p-12 lg:p-16 flex flex-col justify-center gap-6">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded bg-primary flex items-center justify-center font-bold text-white shadow-[0_0_15px_rgba(var(--primary),0.5)]">
                P
              </div>
              <span className="text-xl font-bold">Present</span>
            </div>
            <h3 className="text-4xl lg:text-5xl font-bold leading-tight">Present like a pro</h3>
            <p className="text-lg text-muted-foreground leading-relaxed max-w-md">
              Live presentation and worship software for churches, schools, business presentations, and concerts.
            </p>
            <div className="flex flex-wrap items-center gap-4 mt-6">
              <Link href="#" className="inline-flex h-12 items-center justify-center rounded-md bg-white px-8 text-sm font-medium text-black shadow transition-colors hover:bg-gray-100">
                Subscribe
              </Link>
              <Link href="#" className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-white/5 px-6 text-sm font-medium text-white transition-colors hover:bg-white/10">
                <Download className="w-4 h-4" />
              </Link>
              <Link href="#" className="inline-flex h-12 items-center justify-center gap-2 px-4 text-sm font-medium text-white transition-colors hover:text-primary group">
                Learn more <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>
            </div>
          </div>
          <div className="relative h-64 lg:h-auto min-h-[400px]">
            <img 
              src="https://images.unsplash.com/photo-1551288049-bebda4e38f71?q=80&w=1200&auto=format&fit=crop" 
              alt="Software Dashboard" 
              className="absolute inset-0 w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-card via-transparent to-transparent lg:w-1/3" />
          </div>
        </div>
      </div>
    </section>
  );
}
