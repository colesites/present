"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Download } from "lucide-react";
import { useRef, useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { desktopDownloadPath } from "@/lib/download";
import RadialGlow from "@/components/ui/radial-glow";

gsap.registerPlugin(ScrollTrigger);

export function Hero() {
  const sectionRef = useRef<HTMLElement>(null);
  const h1Ref = useRef<HTMLHeadingElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);
  const descRef = useRef<HTMLParagraphElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);
  const imgContainerRef = useRef<HTMLDivElement>(null);
  const proRef = useRef<HTMLSpanElement>(null);
  const presentRef = useRef<HTMLSpanElement>(null);
  const erRef = useRef<HTMLSpanElement>(null);
  const likeProRef = useRef<HTMLSpanElement>(null);
  const proPath1Ref = useRef<SVGPathElement>(null);
  const proPath2Ref = useRef<SVGPathElement>(null);
  const erPath1Ref = useRef<SVGPathElement>(null);
  const erPath2Ref = useRef<SVGPathElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const ease = "power3.out";

      // ── Hero text timeline ────────────────────────────────────────────────
      const tl = gsap.timeline({ defaults: { ease } });

      // "Pro" fragment fades in
      tl.fromTo(proRef.current, { opacity: 0 }, { opacity: 1, duration: 0.34 }, 0.08);

      // "er" fragment fades in
      tl.fromTo(erRef.current, { opacity: 0 }, { opacity: 1, duration: 0.34 }, 0.16);

      // "Present" scales in
      tl.fromTo(
        presentRef.current,
        { opacity: 0, scale: 0.9 },
        { opacity: 1, scale: 1, duration: 0.72, ease: "back.out(1.4)" },
        0.54
      );

      // SVG stroke on "Pro"
      tl.fromTo(
        proPath1Ref.current,
        { strokeDasharray: "0 400", opacity: 0 },
        { strokeDasharray: "400 0", opacity: 1, duration: 0.62 },
        0.2
      );
      tl.fromTo(
        proPath2Ref.current,
        { strokeDasharray: "0 400", opacity: 0 },
        { strokeDasharray: "400 0", opacity: 1, duration: 0.62 },
        0.34
      );

      // SVG stroke on "er"
      tl.fromTo(
        erPath1Ref.current,
        { strokeDasharray: "0 300", opacity: 0 },
        { strokeDasharray: "300 0", opacity: 1, duration: 0.62 },
        0.46
      );
      tl.fromTo(
        erPath2Ref.current,
        { strokeDasharray: "0 300", opacity: 0 },
        { strokeDasharray: "300 0", opacity: 1, duration: 0.62 },
        0.6
      );

      // "like a pro" subtitle
      tl.fromTo(likeProRef.current, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.46 }, 1.0);

      // Badge
      tl.fromTo(badgeRef.current, { opacity: 0, y: 10 }, { opacity: 0.8, y: 0, duration: 0.42 }, 1.15);

      // Description
      tl.fromTo(descRef.current, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.58 }, 1.24);

      // CTA buttons
      tl.fromTo(ctaRef.current, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.54 }, 1.34);

      // Hero image card
      tl.fromTo(
        imgContainerRef.current,
        { opacity: 0, y: 40, scale: 0.97 },
        { opacity: 1, y: 0, scale: 1, duration: 0.9, ease: "power2.out" },
        1.48
      );

      // ── Scroll-based parallax on hero image ───────────────────────────────
      gsap.to(imgContainerRef.current, {
        y: -60,
        ease: "none",
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top top",
          end: "bottom top",
          scrub: 1.2,
        },
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative overflow-hidden pt-32 pb-20 lg:pt-48 px-6 lg:px-12 flex flex-col items-center justify-center text-center"
    >
      <RadialGlow />

      <div className="container mx-auto relative z-10 flex flex-col items-center max-w-4xl mb-16">
        {/* ── Heading ── */}
        <h1
          ref={h1Ref}
          className="text-5xl md:text-6xl lg:text-[7rem] font-bold tracking-tight leading-none mb-4 lg:mb-6 text-white font-outfit flex flex-col items-center"
        >
          <span className="flex flex-wrap items-center justify-center">
            {/* "Pro" (struck-through legacy fragment) */}
            <span className="hero-legacy-wrap">
              <span ref={proRef} className="hero-legacy-fragment" style={{ opacity: 0 }}>
                Pro
              </span>
              <svg viewBox="0 0 140 44" preserveAspectRatio="none" className="hero-marker hero-marker-pro" aria-hidden="true">
                <path
                  ref={proPath1Ref}
                  d="M6 30 C 30 12, 72 37, 134 13"
                  className="hero-marker-path"
                  strokeWidth={6}
                  strokeDasharray="0 400"
                />
                <path
                  ref={proPath2Ref}
                  d="M9 34 C 40 20, 84 40, 137 18"
                  className="hero-marker-path"
                  strokeWidth={4.8}
                  strokeDasharray="0 400"
                />
              </svg>
            </span>

            {/* "Present" */}
            <span ref={presentRef} className="hero-present-reveal" style={{ opacity: 0 }}>
              Present
            </span>

            {/* "er" (struck-through legacy fragment) */}
            <span className="hero-legacy-wrap">
              <span ref={erRef} className="hero-legacy-fragment" style={{ opacity: 0 }}>
                er
              </span>
              <svg viewBox="0 0 120 42" preserveAspectRatio="none" className="hero-marker hero-marker-er" aria-hidden="true">
                <path
                  ref={erPath1Ref}
                  d="M5 29 C 32 13, 70 34, 114 12"
                  className="hero-marker-path"
                  strokeWidth={6}
                  strokeDasharray="0 300"
                />
                <path
                  ref={erPath2Ref}
                  d="M7 34 C 36 22, 78 37, 116 18"
                  className="hero-marker-path"
                  strokeWidth={4.8}
                  strokeDasharray="0 300"
                />
              </svg>
            </span>
          </span>

          {/* "like a pro" */}
          <span
            ref={likeProRef}
            className="mt-2 text-2xl md:text-4xl lg:text-7xl font-medium tracking-tight text-white/72"
            style={{ opacity: 0 }}
          >
            like a pro
          </span>
        </h1>

        {/* ── Badge ── */}
        <div ref={badgeRef} className="flex items-center gap-3 mb-8" style={{ opacity: 0 }}>
          <div className="h-5 w-5 rounded-sm bg-primary flex items-center justify-center font-bold text-white text-[10px] shadow-[0_0_15px_rgba(var(--primary),0.5)]">
            <span className="translate-y-[0.5px]">P</span>
          </div>
          <span className="text-xs font-bold tracking-[0.2em] uppercase text-white/60">Present</span>
        </div>

        {/* ── Description ── */}
        <p
          ref={descRef}
          className="text-lg md:text-xl text-white/50 leading-relaxed max-w-2xl mb-12 font-medium"
          style={{ opacity: 0 }}
        >
          Presentation software for live events — churches, conferences, and anywhere a room is watching a screen. Keep your library in the cloud, work with your whole team in real time, and find any lyric or Bible verse the moment it is spoken.
        </p>

        {/* ── CTA buttons ── */}
        <div ref={ctaRef} className="flex items-center justify-center gap-3 md:gap-5 w-full max-w-sm md:max-w-none px-2 md:px-0" style={{ opacity: 0 }}>
          <Link
            href="/sign-in"
            className="flex-1 md:flex-none inline-flex h-12 md:h-14 items-center justify-center gap-2 rounded-lg bg-white px-2 md:px-8 text-[13px] md:text-[15px] font-bold text-black shadow-xl transition-all hover:scale-[1.03] active:scale-[0.98] whitespace-nowrap"
          >
            Get started
            <ArrowRight className="h-4 w-4 md:h-5 md:w-5 shrink-0" />
          </Link>
          <Link
            href={desktopDownloadPath}
            className="flex-1 md:flex-none inline-flex h-12 md:h-14 items-center justify-center gap-2 rounded-lg border border-white/20 px-2 md:px-8 text-[13px] md:text-[15px] font-semibold text-white transition-all hover:border-white/35 hover:bg-white/5 whitespace-nowrap"
          >
            Download
            <Download className="h-4 w-4 shrink-0" />
          </Link>
        </div>
      </div>

      {/* ── Hero image — responsive layouts ── */}
      <div ref={imgContainerRef} className="hero-img-card" style={{ opacity: 0 }}>
        <div className="hero-img-inner bg-black md:bg-transparent">
          
          {/* Base image wrapper — blurred and dimmed on mobile for atmospheric effect */}
          <div className="absolute inset-0 opacity-30 md:opacity-100 blur-[4px] md:blur-none transition-all">
            <Image
              src="/present-hero-img.png"
              alt="Present presentation software — live lyrics, scripture and media on an audience screen"
              fill
              className="object-cover object-top md:object-center transition-transform duration-700 md:group-hover:scale-[1.02]"
              priority
            />
          </div>

          {/* Desktop overlay */}
          <div className="hidden md:block absolute inset-0 bg-linear-to-t from-black/40 via-transparent to-transparent pointer-events-none" />

          {/* Mobile overlays: solid black fade from top for text readability, and primary color glow bleeding upward */}
          <div className="block md:hidden absolute inset-0 bg-linear-to-b from-black via-black via-65% to-transparent pointer-events-none" />
          <div className="block md:hidden absolute inset-x-0 bottom-0 h-[35%] bg-linear-to-t from-primary/80 via-primary/20 to-transparent mix-blend-screen pointer-events-none" />
        </div>
      </div>
    </section>
  );
}
