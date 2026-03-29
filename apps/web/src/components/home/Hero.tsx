"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Download } from "lucide-react";
import { motion } from "framer-motion";
import { desktopDownloadPath } from "@/lib/download";
import { heroEase } from "@/utils/constants";
import RadialGlow from "@/components/ui/radial-glow";

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-32 pb-20 lg:pt-48 px-6 lg:px-12 flex flex-col items-center justify-center text-center">
      {/* Massive radial glow using primary blue on black background */}
      <RadialGlow />
      
      <div className="container mx-auto relative z-10 flex flex-col items-center max-w-4xl mb-16">
        <motion.h1
          className="text-6xl lg:text-[7rem] font-bold tracking-tight leading-none mb-6 text-white font-outfit flex flex-col items-center"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: heroEase }}
        >
          <span className="flex flex-wrap items-center justify-center">
            <span className="hero-legacy-wrap">
              <motion.span
                className="hero-legacy-fragment"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.08, duration: 0.34, ease: heroEase }}
              >
                Pro
              </motion.span>
              <svg viewBox="0 0 140 44" preserveAspectRatio="none" className="hero-marker hero-marker-pro" aria-hidden="true">
                {[
                  { d: "M6 30 C 30 12, 72 37, 134 13", delay: 0.2, width: 6 },
                  { d: "M9 34 C 40 20, 84 40, 137 18", delay: 0.34, width: 4.8 },
                ].map((line, index) => (
                  <motion.path
                    key={`pro-${index}`}
                    className="hero-marker-path"
                    d={line.d}
                    strokeWidth={line.width}
                    initial={{ opacity: 0, pathLength: 0 }}
                    animate={{ opacity: 1, pathLength: 1 }}
                    transition={{ delay: line.delay, duration: 0.62, ease: heroEase }}
                  />
                ))}
              </svg>
            </span>

            <motion.span
              className="hero-present-reveal"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: [0.9, 1.05, 1] }}
              transition={{ delay: 0.54, duration: 0.72, ease: heroEase }}
            >
              Present
            </motion.span>

            <span className="hero-legacy-wrap">
              <motion.span
                className="hero-legacy-fragment"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.16, duration: 0.34, ease: heroEase }}
              >
                er
              </motion.span>
              <svg viewBox="0 0 120 42" preserveAspectRatio="none" className="hero-marker hero-marker-er" aria-hidden="true">
                {[
                  { d: "M5 29 C 32 13, 70 34, 114 12", delay: 0.46, width: 6 },
                  { d: "M7 34 C 36 22, 78 37, 116 18", delay: 0.6, width: 4.8 },
                ].map((line, index) => (
                  <motion.path
                    key={`er-${index}`}
                    className="hero-marker-path"
                    d={line.d}
                    strokeWidth={line.width}
                    initial={{ opacity: 0, pathLength: 0 }}
                    animate={{ opacity: 1, pathLength: 1 }}
                    transition={{ delay: line.delay, duration: 0.62, ease: heroEase }}
                  />
                ))}
              </svg>
            </span>
          </span>
          <motion.span
            className="mt-2 text-3xl md:text-5xl lg:text-7xl font-medium tracking-tight text-white/72"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1, duration: 0.46, ease: heroEase }}
          >
            like a pro
          </motion.span>
        </motion.h1>

        <motion.div
          className="flex items-center gap-3 mb-8 opacity-80"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 0.8, y: 0 }}
          transition={{ delay: 1.15, duration: 0.42, ease: heroEase }}
        >
          <div className="h-5 w-5 rounded-sm bg-primary flex items-center justify-center font-bold text-white text-[10px] shadow-[0_0_15px_rgba(var(--primary),0.5)]">
            <span className="translate-y-[0.5px]">P</span>
          </div>
          <span className="text-xs font-bold tracking-[0.2em] uppercase text-white/60">Present</span>
        </motion.div>
        
        <motion.p
          className="text-lg md:text-xl text-white/50 leading-relaxed max-w-2xl mb-12 font-medium"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.24, duration: 0.58, ease: heroEase }}
        >
          Present is the definitive choice in live production & presentation software. Take your events to the next level with Present&apos;s intuitive features and stunning visuals.
        </motion.p>
        
        <motion.div
          className="flex flex-wrap items-center justify-center gap-5"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.34, duration: 0.54, ease: heroEase }}
        >
          <Link href="/sign-in" className="inline-flex h-14 items-center justify-center gap-2 rounded-lg bg-white px-8 text-[15px] font-bold text-black shadow-xl transition-all hover:scale-[1.03] active:scale-[0.98]">
            Get started
            <ArrowRight className="h-5 w-5" />
          </Link>
          <Link
            href={desktopDownloadPath}
            className="inline-flex h-14 items-center justify-center gap-2 rounded-lg border border-white/20 px-8 text-[15px] font-semibold text-white transition-all hover:border-white/35 hover:bg-white/5"
          >
            Download
            <Download className="h-4 w-4" />
          </Link>
        </motion.div>
      </div>

      {/* Main Hero Container */}
      <motion.div
        className="relative w-full max-w-6xl mx-auto z-20 px-4"
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 1.48, duration: 0.74, ease: heroEase }}
      >
        {/* Main large image */}
        <div className="relative aspect-[16/9] w-full rounded-2xl overflow-hidden shadow-[0_40px_100px_rgba(0,0,0,0.8)] ring-1 ring-white/10 group">
          <Image 
            src="https://images.unsplash.com/photo-1438232992991-995b7058bbb3?q=80&w=2000&auto=format&fit=crop" 
            alt="Live event worship experience" 
            fill
            className="object-cover transition-transform duration-700 group-hover:scale-[1.02]"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
          
          {/* Hero text overlay matching ProPresenter */}
          <div className="absolute inset-0 flex items-center justify-center text-center px-10">
            <h3 className="text-3xl md:text-5xl lg:text-7xl font-bold tracking-[0.15em] uppercase text-white drop-shadow-[0_4px_12px_rgba(0,0,0,0.8)] leading-tight">
              &apos;CAUSE ANOTHER ONE IS ON THE WAY
            </h3>
          </div>

          {/* Picture-in-Picture Preview Inset */}
          <div className="absolute bottom-8 left-8 w-48 lg:w-80 rounded-xl overflow-hidden border-4 border-primary shadow-[0_20px_50px_rgba(0,0,0,0.6)] hidden md:block group/pip">
            <div className="relative aspect-video w-full">
              <Image 
                src="https://images.unsplash.com/photo-1438232992991-995b7058bbb3?q=80&w=600&auto=format&fit=crop" 
                alt="Preview snippet" 
                fill
                className="object-cover"
              />
              <div className="absolute inset-0 bg-black/20" />
              
              {/* Overlay inside PIP */}
              <div className="absolute inset-0 flex items-center justify-center p-4">
               <span className="text-[10px] lg:text-sm font-bold tracking-widest uppercase text-white text-center leading-tight drop-shadow-md">
                 &apos;CAUSE ANOTHER ONE IS ON THE WAY
               </span>
              </div>
              
              <div className="absolute bottom-0 left-0 w-full bg-primary py-1.5 px-4">
                <span className="text-white text-[10px] lg:text-xs font-black uppercase tracking-[0.2em]">Chorus</span>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
