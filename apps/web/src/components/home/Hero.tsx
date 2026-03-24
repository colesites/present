import Link from "next/link";
import Image from "next/image";
import { ArrowRight } from "lucide-react";

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-32 pb-20 lg:pt-48 px-6 lg:px-12 flex flex-col items-center justify-center text-center">
      {/* Massive radial glow using primary blue on black background */}
      <div className="absolute top-[40%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-[1200px] aspect-square bg-primary/20 rounded-full blur-[160px] opacity-70 pointer-events-none" />
      
      <div className="container mx-auto relative z-10 flex flex-col items-center max-w-4xl mb-16">
        <div className="flex items-center gap-3 mb-8 opacity-80">
          <div className="h-5 w-5 rounded-sm bg-primary flex items-center justify-center font-bold text-white text-[10px] shadow-[0_0_15px_rgba(var(--primary),0.5)]">
            <span className="translate-y-[0.5px]">P</span>
          </div>
          <span className="text-xs font-bold tracking-[0.2em] uppercase text-white/60">Present</span>
        </div>
        
        <h1 className="text-6xl lg:text-[7rem] font-bold tracking-tight leading-none mb-8 text-white font-outfit flex flex-wrap items-center justify-center">
          <span className="relative inline-block px-1">
            <span className="text-white/20">Pro</span>
            <svg 
              viewBox="0 0 100 20" 
              preserveAspectRatio="none" 
              className="absolute top-1/2 left-[-5%] w-[110%] h-6 lg:h-10 -translate-y-1/2 text-primary drop-shadow-[0_0_8px_rgba(var(--primary),0.5)]"
            >
              <path 
                d="M0 13 Q 50 16, 100 7" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="5" 
                strokeLinecap="round" 
              />
            </svg>
          </span>
          <span>Present</span>
          <span className="ml-4 text-white/90">like a pro</span>
        </h1>
        
        <p className="text-lg md:text-xl text-white/50 leading-relaxed max-w-2xl mb-12 font-medium">
          Present is the definitive choice in live production & presentation software. Take your events to the next level with Present&apos;s intuitive features and stunning visuals.
        </p>
        
        <div className="flex flex-wrap items-center justify-center gap-8">
          <Link href="#" className="inline-flex h-14 items-center justify-center rounded-lg bg-white px-10 text-[15px] font-bold text-black shadow-xl transition-all hover:scale-[1.03] active:scale-[0.98]">
            Subscribe
          </Link>
          <Link href="#" className="inline-flex h-14 items-center justify-center gap-2 group px-4 text-[15px] font-semibold text-white transition-colors hover:text-white/80">
            Start a $0 trial <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>
      </div>

      {/* Main Hero Container */}
      <div className="relative w-full max-w-6xl mx-auto z-20 px-4">
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
      </div>
    </section>
  );
}
