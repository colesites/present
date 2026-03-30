"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const TESTIMONIALS = [
  {
    name: "Olivia Martinez",
    role: "Frontend Developer",
    title: "Best in class components",
    text: "After trying every UI library out there, this is the one that stuck. The quality and consistency are unmatched.",
    initials: "OM",
  },
  {
    name: "Priya Patel",
    role: "Startup Founder",
    title: "Saved us $50k in design costs",
    text: "We were about to hire a design agency. Instead, we used these components and achieved even better results at a fraction of the cost.",
    initials: "PP",
  },
  {
    name: "Robert Kim",
    role: "Product Manager",
    title: "Clients love the results",
    text: "Every project we deliver now gets compliments on the UI. It has genuinely increased the perceived value of our work.",
    initials: "RK",
  },
  {
    name: "Lisa Thompson",
    role: "Agency Director",
    title: "Our secret weapon",
    text: "Aceternity UI is the competitive edge we didn't know we needed. The quality is on par with top-tier design agencies.",
    initials: "LT",
  },
  {
    name: "Nina Kowalski",
    role: "Lead Designer",
    title: "Perfect for rapid prototyping",
    text: "We went from concept to production in record time. The flexibility of each component makes customization a breeze.",
    initials: "NK",
  },
  {
    name: "Alex Turner",
    role: "Full Stack Developer",
    title: "The animations are buttery smooth",
    text: "I've never seen such smooth motion in a component library. The motion primitives alone are worth the investment.",
    initials: "AT",
  },
  {
    name: "Chris Anderson",
    role: "Creative Director",
    title: "A designer's dream toolkit",
    text: "As a designer who codes, these components speak my language. They look beautiful by default with enough hooks to make them truly mine.",
    initials: "CA",
  },
  {
    name: "Aisha Mohammed",
    role: "Design System Lead",
    title: "Supercharged our workflow",
    text: "We integrated these components into our design system and now ship features twice as fast with better visual consistency.",
    initials: "AM",
  }
];

// Fixed scattered positions for the 8 background cards
const SCATTERED_POSITIONS = [
  { top: "15%", left: "15%" },     // Top Left
  { top: "25%", left: "85%" },     // Top Right
  { top: "50%", left: "15%" },     // Mid Left
  { top: "60%", left: "90%" },     // Mid Right
  { top: "80%", left: "25%" },     // Bottom Left
  { top: "85%", left: "75%" },     // Bottom Right
  { top: "35%", left: "80%" },     // Mid-High Right
  { top: "70%", left: "50%" },     // Bottom Center
];

function TestimonialCard({ t, cardRef }: { t: typeof TESTIMONIALS[0]; cardRef: React.Ref<HTMLDivElement> }) {
  return (
    <div 
      ref={cardRef}
      className={`absolute w-full max-w-[320px] md:max-w-[400px] p-6 md:p-8 rounded-2xl md:rounded-3xl border border-white/5 bg-[#18181b] shadow-2xl z-0 opacity-0`} // Start invisible
      style={{
        transform: "translate(-50%, -50%)", // Center on the exact coord
      }}
    >
      <div className="font-semibold text-white/90 text-lg md:text-xl mb-4">
        &quot;{t.title}&quot;
      </div>
      <p className="text-white/60 text-sm md:text-base leading-relaxed mb-6">
        {t.text}
      </p>
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-linear-to-br from-blue-500 to-primary flex items-center justify-center text-white font-bold text-[10px] shrink-0 shadow-lg">
          {t.initials}
        </div>
        <div>
          <h5 className="text-white/90 font-medium text-sm md:text-base">{t.name}</h5>
        </div>
      </div>
    </div>
  );
}

import { TextPressure } from "@/components/ui/TextPressure";

export function Testimonials() {
  const containerRef = useRef<HTMLElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    let currentIdx = 0;
    const cards = cardsRef.current;
    if (!cards.length) return;

    // A helper to softly clamp positions so they don't visually clip off-screen heavily
    const getLeftPos = (percent: string) => `clamp(180px, ${percent}, calc(100vw - 180px))`;
    
    const ACTIVE_POS = { top: "15%", left: "50%" };

    const ctx = gsap.context(() => {
      // 1. Initial State Initialization
      cards.forEach((card, i) => {
         if (!card) return;
         if (i === currentIdx) {
            // Card 0 launches immediately into the active center top spot
            gsap.set(card, { top: ACTIVE_POS.top, left: ACTIVE_POS.left, opacity: 1, scale: 1, zIndex: 50 });
         } else {
            // All other cards are softly scattered in the dark background
            const pos = SCATTERED_POSITIONS[i];
            gsap.set(card, { top: pos.top, left: getLeftPos(pos.left), opacity: 0.1, scale: 0.85, zIndex: 0 });
         }
      });

      // 2. Turn-by-turn cycling mechanism
      const interval = setInterval(() => {
        const prevIdx = currentIdx;
        currentIdx = (currentIdx + 1) % TESTIMONIALS.length;
        
        const prevCard = cards[prevIdx];
        const nextCard = cards[currentIdx];

        if (!prevCard || !nextCard) return;

        // A. The previous active card diagonally exits UP & RIGHT, fading into the abyss
        gsap.to(prevCard, {
          top: "20%",      // Move up aggressively
          left: "70%",      // Move right (diagonal exit)
          opacity: 0,       // Fade out cleanly
          scale: 0.8,
          duration: 1.4,
          ease: "power3.inOut",
          onComplete: () => {
             // Silently reset it securely to its permanent scattered background position
             const pos = SCATTERED_POSITIONS[prevIdx];
             gsap.set(prevCard, { 
                top: pos.top, 
                left: getLeftPos(pos.left), 
                opacity: 0.1, 
                scale: 0.85, 
                zIndex: 0 
             });
          }
        });

        // B. The next background card flies directly into the active slot!
        gsap.set(nextCard, { zIndex: 50 }); // Prioritize rendered layer immediately
        gsap.to(nextCard, {
          top: ACTIVE_POS.top,
          left: ACTIVE_POS.left,
          opacity: 1,
          scale: 1,
          duration: 1.4,
          ease: "power3.inOut"
        });

      }, 4500); // Trigger every 4.5 seconds continuously

      // Central text pop-in on scroll
      gsap.fromTo(textRef.current, 
        { opacity: 0, scale: 0.9, y: 30 },
        { 
          opacity: 1, scale: 1, y: 0, duration: 1.5, ease: "power4.out",
          scrollTrigger: {
            trigger: containerRef.current,
            start: "top 75%",
          }
        }
      );

      return () => clearInterval(interval);
    }, containerRef);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={containerRef} className="relative w-full bg-black py-48 overflow-hidden min-h-[1200px] flex items-center justify-center">
      {/* Subtle aceternity dotted background layout */}
      <div 
         className="absolute inset-0 opacity-20 select-none pointer-events-none" 
         style={{ backgroundImage: "radial-gradient(circle at center, rgba(255,255,255,0.2) 1.5px, transparent 1.5px)", backgroundSize: "32px 32px" }}
      />

      {/* Renders all cards absolutely layered over the entire section */}
      {TESTIMONIALS.map((t, i) => (
         <TestimonialCard 
            key={i} 
            t={t} 
            cardRef={(el: HTMLDivElement | null) => { cardsRef.current[i] = el; }} 
         />
      ))}

      {/* Seamless transition gradients tying into the surrounding pages */}
      <div className="absolute top-0 left-0 w-full h-48 bg-linear-to-b from-black to-transparent z-10 pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-full h-64 bg-linear-to-t from-black via-black/90 to-transparent z-10 pointer-events-none" />
      <div className="absolute left-0 top-0 h-full w-24 md:w-64 bg-linear-to-r from-black to-transparent z-10 pointer-events-none" />
      <div className="absolute right-0 top-0 h-full w-24 md:w-64 bg-linear-to-l from-black to-transparent z-10 pointer-events-none" />

      {/* Fixed Central Content Overlay slightly beneath the active card section */}
      <div ref={textRef} className="absolute top-[60%] left-1/2 -translate-x-1/2 -translate-y-1/2 z-70 container mx-auto px-6 text-center w-full max-w-6xl pointer-events-auto">
        <div className="relative h-[200px] md:h-[300px] w-full max-w-5xl mx-auto flex items-center justify-center mb-6">
          <TextPressure 
            text="Loved by churches across the world"
            fontFamily="Stretch Sans"
            fontUrl="https://res.cloudinary.com/dr6lvwubh/raw/upload/v1529908256/CompressaPRO-GX.woff2"
            flex={true}
            alpha={false}
            stroke={false}
            width={true}
            weight={true}
            italic={true}
            textColor="#ffffff"
            strokeColor="#5227FF"
            minFontSize={80}
            className="drop-shadow-[0_0_20px_rgba(255,255,255,0.1)]"
          />
        </div>
        <p className="text-lg md:text-xl text-white/50 leading-relaxed font-medium max-w-xl mx-auto drop-shadow-md">
          Hear from our community of builders, designers, and creators who trust us to power their projects.
        </p>
      </div>
    </section>
  );
}
