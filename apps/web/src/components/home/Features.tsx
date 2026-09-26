"use client";

import { useRef, useEffect, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Image from "next/image";

gsap.registerPlugin(ScrollTrigger);

// ─── Images from Unsplash (dark, church/tech aesthetic) ──────────────────────
const IMAGES = {
  // An open Bible in stained-glass light, by Shane Hoving (Unsplash License).
  bibleAgent:
    "https://images.unsplash.com/photo-1650065045891-e3a7c96a4ad7?w=900&q=80&fit=crop",
  songAgent:
    "https://images.unsplash.com/photo-1598387181032-a3103a2db5b3?w=900&q=80&fit=crop",
  multiUser:
    "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=900&q=80&fit=crop",
  cloudSync:
    "https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=900&q=80&fit=crop",
  groupDisplay:
    "https://images.unsplash.com/photo-1516280440614-37939bbacd81?w=900&q=80&fit=crop",
  remoteControl:
    "https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?w=900&q=80&fit=crop",
  mediaStage:
    "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=900&q=80&fit=crop",
  worshipStage:
    "https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?w=900&q=80&fit=crop",
  liveStreaming:
    "https://images.unsplash.com/photo-1606904825846-647eb07f5be2?w=900&q=80&fit=crop",
  searchOnline:
    "https://images.unsplash.com/photo-1510915228340-29c85a43dcfe?w=900&q=80&fit=crop",
  fixLyrics:
    "https://images.unsplash.com/photo-1519892300165-cb5542fb47c7?w=900&q=80&fit=crop",
  autoSave:
    "https://images.unsplash.com/photo-1555949963-ff9fe0c870eb?w=900&q=80&fit=crop",
};

// ─── Rotating words animation ─────────────────────────────────────────────────
const rotatingPhrases = [
  "worship teams.",
  "live events.",
  "sunday services.",
  "broadcast crews.",
  "your whole team.",
];

function RotatingWord() {
  const [idx, setIdx] = useState(0);
  const wordRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      const el = wordRef.current;
      if (!el) return;
      gsap.to(el, {
        y: -20,
        opacity: 0,
        duration: 0.3,
        ease: "power2.in",
        onComplete: () => {
          setIdx((i) => (i + 1) % rotatingPhrases.length);
          gsap.fromTo(
            el,
            { y: 20, opacity: 0 },
            { y: 0, opacity: 1, duration: 0.4, ease: "power3.out" }
          );
        },
      });
    }, 2200);
    return () => clearInterval(interval);
  }, []);

  return (
    <span
      ref={wordRef}
      className="text-primary inline-block"
      style={{ display: "inline-block" }}
    >
      {rotatingPhrases[idx]}
    </span>
  );
}

// ─── Line reveal animation ────────────────────────────────────────────────────
function useLineReveal(ref: React.RefObject<HTMLElement | null>, delay = 0) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const lines = gsap.utils.toArray<HTMLElement>(".line-inner", el);
    const ctx = gsap.context(() => {
      gsap.fromTo(
        lines,
        { y: "110%" },
        {
          y: "0%",
          duration: 0.85,
          ease: "power4.out",
          stagger: 0.1,
          delay,
          scrollTrigger: {
            trigger: el,
            start: "top 85%",
            toggleActions: "play none none none",
          },
        }
      );
    }, el);
    return () => ctx.revert();
  }, [ref, delay]);
}

// ─── Feature Row: full-width alternating layout ──────────────────────────────
interface FeatureRowProps {
  num: string;
  label: string;
  description: string;
  image: string;
  reverse?: boolean;
  tag?: string;
}

function FeatureRow({ num, label, description, image, reverse, tag }: FeatureRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const numRef = useRef<HTMLSpanElement>(null);

  useLineReveal(textRef as React.RefObject<HTMLElement>);

  useEffect(() => {
    const ctx = gsap.context(() => {
      // Aggressive glitchy reveal for the big number
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: rowRef.current,
          start: "top 80%",
          toggleActions: "play none none reverse",
        }
      });

      tl.fromTo(
        numRef.current,
        { scale: 3.5, opacity: 0, skewX: 60, rotationZ: -10, filter: "blur(30px)", x: -100, y: 150 },
        { scale: 1, opacity: 0.15, skewX: -20, rotationZ: 5, filter: "blur(8px)", x: 20, y: -20, duration: 0.5, ease: "expo.out" }
      )
      .to(numRef.current, { skewX: 15, rotationZ: -2, filter: "blur(0px)", opacity: 0.08, duration: 0.2, ease: "power2.out" })
      .to(numRef.current, { skewX: 0, rotationZ: 0, x: 0, y: 0, opacity: 0.05, duration: 0.4, ease: "back.out(2)" });

      // Floating scrub for the number
      gsap.to(numRef.current, {
        y: -150,
        rotationZ: reverse ? 5 : -5,
        ease: "none",
        scrollTrigger: {
          trigger: rowRef.current,
          start: "top bottom",
          end: "bottom top",
          scrub: 1.2,
        }
      });

      // Image slides in from side
      gsap.fromTo(
        imgRef.current,
        { opacity: 0, x: reverse ? 100 : -100, scale: 0.9 },
        {
          opacity: 1,
          x: 0,
          scale: 1,
          duration: 1.4,
          ease: "expo.out",
          scrollTrigger: {
            trigger: rowRef.current,
            start: "top 78%",
            toggleActions: "play none none none",
          },
        }
      );
    }, rowRef);
    return () => ctx.revert();
  }, [reverse]);

  return (
    <div
      ref={rowRef}
      className={`feature-row grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-center py-24 border-t border-white/5 relative overflow-visible ${
        reverse ? "lg:flex lg:flex-row-reverse" : ""
      }`}
    >
      {/* Text */}
      <div ref={textRef} className={`relative z-10 ${reverse ? "lg:pl-8" : ""}`}>
        <div className="flex items-center gap-3 mb-6 relative h-10">
          <span 
            ref={numRef} 
            className="section-num inline-block absolute -top-12 -left-6 z-[-1]" 
            style={{ transformOrigin: "center center", willChange: "transform, opacity, filter" }}
          >
            {num}
          </span>
          {tag && (
            <span className="text-xs font-bold tracking-[0.2em] uppercase text-primary/70 border border-primary/30 px-3 py-1 rounded-full bg-background/60 backdrop-blur-md">
              {tag}
            </span>
          )}
        </div>
        <h3 className="text-4xl lg:text-6xl font-bold text-white mb-4 lg:mb-6 leading-none tracking-tight">
          {label.split(" ").map((word, i) => (
            <span key={i} className="line-clip">
              <span className="line-inner">{word} </span>
            </span>
          ))}
        </h3>
        <p className="line-clip">
          <span className="line-inner text-base lg:text-lg text-white/45 leading-relaxed">{description}</span>
        </p>
      </div>

      {/* Image */}
      <div ref={imgRef} className="feature-img aspect-[4/3] lg:aspect-[3/2] relative overflow-hidden rounded-2xl md:rounded-3xl" style={{ opacity: 0 }}>
        <Image 
          src={image} 
          alt={label} 
          fill 
          className="object-cover"
          sizes="(max-width: 768px) 100vw, 50vw"
        />
        <div className="absolute inset-0 bg-linear-to-t from-black/40 via-transparent to-transparent rounded-[inherit]" />
      </div>
    </div>
  );
}

// ─── Horizontal drag carousel ─────────────────────────────────────────────────
interface HCardProps {
  num: number;
  label: string;
  description: string;
  image: string;
}

const hCards: HCardProps[] = [
  { num: 1, label: "Group Display", description: "Drive 1–4 independent screens simultaneously. Each audience sees exactly what they need.", image: IMAGES.groupDisplay },
  { num: 2, label: "Remote Control", description: "Control your show from any device on the network. Walk the stage, lead the song.", image: IMAGES.remoteControl },
  { num: 3, label: "Media Stage", description: "A dedicated stage for video loops, motion backgrounds, and live camera feeds.", image: IMAGES.mediaStage },
  { num: 4, label: "Worship Stage", description: "Lyrics, chord charts, and notes, surfaced beautifully for every musician on stage.", image: IMAGES.worshipStage },
  { num: 5, label: "Live Streaming", description: "Send the audience screen over NDI to OBS, vMix or whatever your stream runs on.", image: IMAGES.liveStreaming },
  { num: 6, label: "Search Songs Online", description: "Tap into a global worship library. Search, preview, and add to your set in seconds.", image: IMAGES.searchOnline },
  { num: 7, label: "AI Fix Lyrics", description: "Paste scattered lyrics and AI restructures them into perfectly cued slides instantly.", image: IMAGES.fixLyrics },
  { num: 8, label: "Auto Save", description: "Every edit saved continuously, versioned in the cloud. Never lose your work again.", image: IMAGES.autoSave },
];

function ScrollStackInteractive() {
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const headingLines = ["EVERYTHING", "YOUR TEAM", "NEEDS"];

  useEffect(() => {
    const ctx = gsap.context(() => {
      const cards = gsap.utils.toArray<HTMLElement>(".stack-card");
      const textEls = gsap.utils.toArray<HTMLElement>(".stack-card-content");
      const imgEls = gsap.utils.toArray<HTMLElement>(".stack-card-img");
      const overlayEls = gsap.utils.toArray<HTMLElement>(".stack-card-overlay");

      // 1. Clean, inline absolute stacking setup
      gsap.set(cards, {
        position: "absolute",
        left: "50%",
        top: "50%",
        xPercent: -50,
        yPercent: -50,
        width: "clamp(320px, 40vw, 480px)",
        height: "clamp(460px, 55vw, 640px)",
        borderRadius: "1.5rem",
        x: () => window.innerWidth + 400, // all offscreen right
        y: 0,
        rotationZ: 0, // Keep perfectly flat, no messy tilts
        // Card 0 must be on TOP so when it bursts it covers the lower cards!
        zIndex: (i) => cards.length - i 
      });

      gsap.set(textEls, { opacity: 0, y: 40 });
      gsap.set(overlayEls, { opacity: 0 });

      // Title letters reveal
      const letters = gsap.utils.toArray<HTMLSpanElement>(".hscroll-letter");
      gsap.fromTo(letters,
        { scaleY: 0, opacity: 0, transformOrigin: "bottom center" },
        {
          scaleY: 1,
          opacity: 1,
          duration: 0.8,
          ease: "elastic.out(1, 0.5)",
          stagger: 0.035,
          scrollTrigger: {
            trigger: containerRef.current,
            start: "top 75%",
            toggleActions: "play none none none"
          }
        }
      );

      // The Master ScrollStack Timeline
      const masterTl = gsap.timeline({
        scrollTrigger: {
          trigger: containerRef.current,
          start: "top top",
          end: `+=${cards.length * 1200 + 1000}`, // Long, leisurely scroll
          scrub: 1,
          pin: true,
          anticipatePin: 1
        }
      });

      // Phase 1: cards elegantly slide in from right to form a tight, overlapping row
      masterTl.to(cards, {
        x: (i) => i * 40, // Subtle horizontal stack
        duration: 1.5,
        stagger: 0.05,
        ease: "power3.out"
      }, "enter");

      masterTl.add("deckReady", "+=0.2");

      // Phase 2: Sequential bursting and shuffling
      cards.forEach((card, i) => {
        masterTl.add(`card${i}Start`);

        // Explode card to full viewport (covers the deck behind it!)
        masterTl.to(card, {
          width: "100%",
          height: "100%",
          x: 0, // perfectly center it
          y: 0,
          borderRadius: 0,
          duration: 1.2,
          ease: "expo.inOut" // Apple cinematic pop
        }, `card${i}Start`);

        // Subtle image zoom effect during expansion
        masterTl.fromTo(imgEls[i], 
          { scale: 1.15 }, 
          { scale: 1, duration: 1.2, ease: "expo.inOut" },
          `card${i}Start`
        );

        // Dark overlay and text entrance
        masterTl.to(overlayEls[i], { opacity: 1, duration: 0.8 }, `card${i}Start+=0.4`);
        masterTl.to(textEls[i], { opacity: 1, y: 0, duration: 0.8, ease: "power3.out" }, `card${i}Start+=0.5`);

        // Hold full-screen card strictly so user reads it
        masterTl.to({}, { duration: 1.5 });

        // Phase out this card to the LEFT as the new top card becomes visible
        if (i < cards.length - 1) {
          const exitLabel = `card${i}End`;
          masterTl.add(exitLabel);
          
          masterTl.to(textEls[i], { opacity: 0, y: -20, duration: 0.4 }, exitLabel);
          
          // Current card scales down slightly and swooshes off-screen left
          masterTl.to(card, { 
             x: -window.innerWidth - 200,
             scale: 0.9,
             opacity: 0, 
             duration: 1.2, 
             ease: "power3.inOut" 
          }, exitLabel);

          // The remaining cards in the deck shift left gracefully to take the pole position
          masterTl.to(cards.slice(i + 1), {
             x: (index) => index * 40, // index 0 is the immediate next card, so it moves to x: 0
             duration: 1,
             ease: "power2.inOut"
          }, `${exitLabel}+=0.3`);
        }
      });
      
    }, containerRef);

    return () => ctx.revert();
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-screen bg-black overflow-hidden flex flex-col justify-center">
      
      {/* Background Section Title */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full text-center z-0 opacity-[0.85] pointer-events-auto drop-shadow-2xl">
        <div
          className="font-stretch text-white leading-[0.85] flex flex-col items-center gap-2 md:gap-5 px-6 select-none"
          style={{ fontSize: "clamp(3.5rem, 15vw, 14rem)", letterSpacing: "-0.04em" }}
          aria-label="EVERYTHING YOUR TEAM NEEDS"
        >
          {headingLines.map((line, lineIdx) => (
            <div key={lineIdx} className="flex flex-wrap justify-center">
              {line.split("").map((char, i) =>
                char === " " ? (
                  <span key={i} className="inline-block" style={{ width: "0.3em" }} />
                ) : (
                  <span
                    key={`${lineIdx}-${i}`}
                    className="hscroll-letter inline-block cursor-default hover:text-primary transition-colors duration-150"
                    style={{ opacity: 0, transformOrigin: "bottom center" }}
                    onMouseEnter={(e) =>
                      gsap.to(e.currentTarget, { scaleY: 1.35, scaleX: 0.88, duration: 0.18, ease: "power2.out" })
                    }
                    onMouseLeave={(e) =>
                      gsap.to(e.currentTarget, { scaleY: 1, scaleX: 1, duration: 0.4, ease: "elastic.out(1.4, 0.4)" })
                    }
                  >
                    {char}
                  </span>
                )
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Embedded 3D Cards Track */}
      <div ref={trackRef} className="relative w-full h-full z-10 pointer-events-none">
        {hCards.map((card) => (
          <div 
            key={card.num} 
            className="stack-card overflow-hidden shadow-[0_0_80px_rgba(0,0,0,0.8)] border border-white/5 relative bg-black will-change-transform"
          >
            <Image 
              src={card.image} 
              alt={card.label} 
              fill
              className="stack-card-img object-cover" 
              sizes="(max-width: 768px) 100vw, 33vw"
            />
            {/* High-contrast mobile-friendly gradients */}
            <div className="stack-card-overlay absolute inset-0 bg-linear-to-t from-black via-black/50 to-transparent mix-blend-multiply" />
            <div className="stack-card-overlay absolute inset-x-0 bottom-0 h-2/3 bg-linear-to-t from-black via-black/80 to-transparent" />
            
            {/* Cinematic Text Reveal */}
            <div className="stack-card-content absolute inset-0 flex flex-col justify-end items-start p-8 md:p-24 pb-16 md:pb-32 text-left pointer-events-auto">
              <span className="font-stretch text-[8rem] md:text-[24rem] leading-none absolute top-4 md:top-12 left-4 md:left-12 opacity-[0.03] select-none text-white pointer-events-none tracking-tighter">
                0{card.num}
              </span>
              <div className="max-w-4xl relative z-10 drop-shadow-2xl">
                <h3 className="text-3xl md:text-4xl font-bold text-white mb-4 tracking-tight leading-none">
                  {card.label}
                </h3>
                <p className="text-white/50 text-base md:text-lg leading-relaxed max-w-sm">
                  {card.description}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Section intro ────────────────────────────────────────────────────────────
function SectionIntro() {
  const ref = useRef<HTMLDivElement>(null);
  useLineReveal(ref as React.RefObject<HTMLElement>);

  return (
    <div ref={ref} className="max-w-3xl mb-16 lg:mb-24">
      <p className="line-clip mb-4">
        <span className="line-inner text-xs font-bold tracking-[0.24em] uppercase text-primary/70">
          Features
        </span>
      </p>
      <h2
        className="text-5xl md:text-7xl lg:text-8xl font-bold text-white leading-[1.1] mb-8"
        style={{ letterSpacing: "-0.03em" }}
      >
        <span className="line-clip block">
          <span className="line-inner">Built for the stage.</span>
        </span>
        <span className="line-clip block text-white/30">
          <span className="line-inner">
            Designed for{" "}
            <RotatingWord />
          </span>
        </span>
      </h2>
      <p className="line-clip">
        <span className="line-inner text-lg text-white/40 leading-relaxed">
          Present combines blazing performance with an intuitive interface, so every volunteer
          can run a world‑class production.
        </span>
      </p>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────
const featureRows = [
  {
    num: "01",
    label: "Bible AI Agent",
    description:
      "It listens to the preacher and puts each verse on screen as it's read, in the translation you choose. When it isn't sure, it asks the operator first.",
    image: IMAGES.bibleAgent,
    tag: "Scripture",
  },
  {
    num: "02",
    label: "Song AI Agent",
    description:
      "It hears what the band starts to sing, finds the song in your library, and follows along line by line. No typing, no hunting, just flow.",
    image: IMAGES.songAgent,
    reverse: true,
    tag: "Songs",
  },
  {
    num: "03",
    label: "Multi-User Collaboration",
    description:
      "Your whole team works together live. Multiple operators, shared queues, one seamless show. No more stepping on each other.",
    image: IMAGES.multiUser,
    tag: "Real-time",
  },
  {
    num: "04",
    label: "Offline-First Cloud Sync",
    description:
      "Works perfectly with zero internet. Every change syncs seamlessly to the cloud the moment you're back online.",
    image: IMAGES.cloudSync,
    reverse: true,
    tag: "Cloud",
  },
];

export function Features() {
  return (
    <section id="features" className="relative bg-background overflow-hidden">
      <div className="absolute inset-0 features-grid-bg pointer-events-none" aria-hidden="true" />

      {/* ── Feature rows ── */}
      <div className="relative z-10 px-6 lg:px-12 pt-32">
        <div className="container mx-auto">
          <SectionIntro />
          <div>
            {featureRows.map((f) => (
              <FeatureRow key={f.num} {...f} />
            ))}
          </div>
        </div>
      </div>

      {/* ── Scroll Stack ── */}
      <div className="relative z-10">
        <ScrollStackInteractive />
      </div>
    </section>
  );
}
