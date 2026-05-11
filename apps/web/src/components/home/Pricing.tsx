"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { useRef, useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const PLANS = [
  {
    name: "Free",
    price: "Free",
    description: "For churches getting started with Present.",
    features: [
      "1 hour/month speech to search",
      "Bible verse search",
      "Library search",
      "Desktop app access",
      "Core presentation workflow",
    ],
    buttonText: "Get Started",
    accent: "white/10",
  },
  {
    name: "Pro",
    price: "Premium",
    period: "/month",
    description: "For teams that rely on live speech search every week.",
    features: [
      "15 hours/month speech to search",
      "Bible speech search",
      "Library speech search",
      "Faster rehearsal workflow",
      "Paid plan billing in Clerk",
      "Everything in Free",
    ],
    buttonText: "Go Pro",
    accent: "primary",
    recommended: true,
  },
  {
    name: "Power",
    price: "Advanced",
    period: "/month",
    description: "For heavy weekly usage across Bible and library search.",
    features: [
      "30 hours/month speech to search",
      "Bible speech search",
      "Library speech search",
      "Best fit for power users",
      "Everything in Pro",
    ],
    buttonText: "Go Power",
    accent: "white/10",
  },
];

export function Pricing() {
  const containerRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const cards = gsap.utils.toArray<HTMLElement>(".pricing-card");
      
      gsap.fromTo(
        cards,
        { opacity: 0, y: 60, scale: 0.95 },
        {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: 1.2,
          stagger: 0.2,
          ease: "power4.out",
          scrollTrigger: {
            trigger: cardsRef.current,
            start: "top 80%",
            toggleActions: "play none none reverse",
          },
        }
      );
    }, containerRef);

    return () => ctx.revert();
  }, []);

  return (
    <section id="pricing" ref={containerRef} className="py-32 bg-background relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/5 rounded-full blur-[120px] pointer-events-none" />
      
      <div className="container mx-auto px-6 relative z-10">
        <div className="max-w-3xl mx-auto text-center mb-24">
          <p className="text-xs font-bold tracking-[0.24em] uppercase text-primary/70 mb-4">Pricing</p>
          <h2 className="text-5xl md:text-7xl lg:text-8xl font-bold text-white mb-8 tracking-tighter leading-none">Built for every stage</h2>
          <p className="text-xl text-white/40 leading-relaxed max-w-2xl mx-auto">
            Choose the plan that fits your congregation. From local small groups to global cathedrals.
          </p>
        </div>

        <div ref={cardsRef} className="grid gap-10 lg:grid-cols-3 max-w-6xl mx-auto">
          {PLANS.map((plan, i) => (
            <div 
              key={i} 
              className={`pricing-card relative p-10 lg:p-16 rounded-[40px] border transition-all duration-500 overflow-hidden group ${
                plan.recommended 
                  ? "bg-primary/5 border-primary/20 shadow-[0_0_80px_rgba(var(--primary),0.05)]" 
                  : "bg-white/2 border-white/5"
              }`}
            >
              {plan.recommended && (
                <div className="absolute top-0 right-12 translate-y-[-50%] bg-primary text-[10px] font-bold uppercase tracking-widest px-4 py-1.5 rounded-full z-20">
                  Most Popular
                </div>
              )}
              
              <div className="mb-8">
                <h3 className="text-xl font-bold text-white mb-2">{plan.name}</h3>
                <div className="flex items-baseline gap-1 mb-4">
                  <span className="text-5xl md:text-6xl font-bold text-white tracking-tight">{plan.price}</span>
                  {plan.period && <span className="text-white/40 text-sm font-medium">{plan.period}</span>}
                </div>
                <p className="text-sm text-white/50 leading-relaxed">{plan.description}</p>
              </div>

              <div className="space-y-4 mb-10">
                {plan.features.map((feature, idx) => (
                  <div key={idx} className="flex items-center gap-3">
                    <div className={`h-5 w-5 rounded-full flex items-center justify-center ${plan.recommended ? "bg-primary/10" : "bg-white/5"}`}>
                      <Check className={`w-3 h-3 ${plan.recommended ? "text-primary" : "text-white/40"}`} />
                    </div>
                    <span className="text-sm text-white/70 font-medium">{feature}</span>
                  </div>
                ))}
              </div>

              <Link
                href="/pricing"
                className={`block w-full rounded-xl py-4 text-center text-sm font-bold transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] ${
                  plan.recommended
                    ? "bg-primary text-white shadow-[0_15px_40px_rgba(var(--primary),0.3)] hover:shadow-[0_20px_50px_rgba(var(--primary),0.4)]"
                    : "bg-white/5 text-white hover:bg-white/10"
                }`}
              >
                {plan.buttonText}
              </Link>
              
              {/* Shine effect */}
              <div className="absolute inset-0 bg-linear-to-br from-white/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
