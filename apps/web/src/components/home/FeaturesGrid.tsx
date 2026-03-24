import { MonitorPlay, Headphones, ShieldCheck, Zap } from "lucide-react";

export function FeaturesGrid() {
  return (
    <section className="py-24 px-6 lg:px-12 relative">
      <div className="container mx-auto">
        <div className="flex flex-col lg:flex-row justify-between items-end gap-6 mb-16">
          <h2 className="text-4xl font-bold tracking-tight">What you can expect</h2>
          <p className="text-lg text-muted-foreground max-w-lg">
            We understand your needs because we share them. We&apos;re live event people, building software for live event people.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Pillar 1 */}
          <div className="bg-card rounded-2xl p-8 border border-white/5 hover:border-primary/50 transition-colors group">
            <div className="h-12 w-12 rounded-full bg-white/5 flex items-center justify-center mb-6 group-hover:bg-primary/20 group-hover:text-primary transition-colors">
              <MonitorPlay className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-bold mb-3">Ease of use</h3>
            <p className="text-muted-foreground leading-relaxed text-sm">
              We build our software with everyone in mind. Each product has intuitive interfaces designed for smooth operation.
            </p>
          </div>
          
          {/* Pillar 2 */}
          <div className="bg-card rounded-2xl p-8 border border-white/5 hover:border-primary/50 transition-colors group">
            <div className="h-12 w-12 rounded-full bg-white/5 flex items-center justify-center mb-6 group-hover:bg-primary/20 group-hover:text-primary transition-colors">
              <Headphones className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-bold mb-3">World-class support</h3>
            <p className="text-muted-foreground leading-relaxed text-sm">
              Our dedicated support team is always here to help you succeed, any day of the week.
            </p>
          </div>

          {/* Pillar 3 */}
          <div className="bg-card rounded-2xl p-8 border border-white/5 hover:border-primary/50 transition-colors group">
            <div className="h-12 w-12 rounded-full bg-white/5 flex items-center justify-center mb-6 group-hover:bg-primary/20 group-hover:text-primary transition-colors">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-bold mb-3">Controlled quality</h3>
            <p className="text-muted-foreground leading-relaxed text-sm">
              Every release is pushed through an intense review process for reliability so you can trust the update.
            </p>
          </div>

          {/* Pillar 4 */}
          <div className="bg-card rounded-2xl p-8 border border-white/5 hover:border-primary/50 transition-colors group">
            <div className="h-12 w-12 rounded-full bg-white/5 flex items-center justify-center mb-6 group-hover:bg-primary/20 group-hover:text-primary transition-colors">
              <Zap className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-bold mb-3">Rapid innovation</h3>
            <p className="text-muted-foreground leading-relaxed text-sm">
              We constantly push boundaries to bring you the latest features. Your needs are evolving, your solutions should too.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
