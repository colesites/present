"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import Image from "next/image";

const LOGO_DATA = [
  { name: "Global Harvest", src: "/global-harvest.png" },
  { name: "The Discovery", src: "/the-discovery.png" },
  { name: "RCCG", src: "/rccg.png" },
  { name: "GLM", src: "/glm.svg" },
  { name: "Elevation", src: "/elevation.png" },
  { name: "Hillsong", src: "/hillsong.png" },
  { name: "Bethel", src: "/bethel.svg" },
];

export function LogosWithBlurFlip() {
  const [mounted, setMounted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [activeLogos, setActiveLogos] = useState(LOGO_DATA.slice(0, 4));
  const logoRefs = useRef<(HTMLDivElement | null)[]>([]);
  const currentIndexRef = useRef(0);

  // Fix cascading render by pushing the mount update to the next animation frame.
  // This allows React to commit the initial "false" state before the next update.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setMounted(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  // 1. Kinetic Typography Animation (Slow-Motion Targeted Stretch)
  useGSAP(() => {
    if (!mounted || !titleRef.current) return;

    // Target ONLY the marked 'C' characters for the cinematic effect
    const chars = titleRef.current.querySelectorAll('.animate-stretch');
    const tl = gsap.timeline({ repeat: -1 });

    chars.forEach((char) => {
      // Extremely slow, cinematic stretch as requested
      tl.to(char, {
        scaleX: 2.8,
        paddingRight: "0.9em",
        duration: 1.8,
        ease: "expo.inOut",
      })
      .to(char, {
        scaleX: 1,
        paddingRight: "0em",
        duration: 1.2,
        ease: "power2.inOut",
      }, "+=0.3"); // Long hold for dramatic effect
    });
  }, { dependencies: [mounted], scope: titleRef });

  // 2. Logo Cycling and Entrance Animation
  useGSAP(() => {
    if (!mounted) return;

    const cycle = () => {
      const tl = gsap.timeline({
        onComplete: () => {
          // Increment base index for strictly circular cycling
          currentIndexRef.current = (currentIndexRef.current + 4) % LOGO_DATA.length;
          
          // Construct exactly 4 logos using a simple circular pointer
          const nextLogos = [];
          for (let i = 0; i < 4; i++) {
            nextLogos.push(LOGO_DATA[(currentIndexRef.current + i) % LOGO_DATA.length]);
          }
          
          setActiveLogos(nextLogos);
        }
      });

      // Staggered Exit
      tl.to(logoRefs.current, {
        opacity: 0,
        filter: "blur(12px)",
        rotateX: -90,
        duration: 0.7,
        stagger: 0.12,
        ease: "power2.in",
      }, "+=4"); // Hold for 4s

      return tl;
    };

    // Entrance Animation for new logos
    gsap.fromTo(logoRefs.current, 
      { opacity: 0, filter: "blur(12px)", rotateX: 90 },
      { 
        opacity: 1, 
        filter: "blur(0px)", 
        rotateX: 0, 
        duration: 0.9, 
        stagger: 0.12, 
        ease: "power3.out" 
      }
    );

    const master = cycle();
    return () => { master.kill(); };
  }, { dependencies: [activeLogos, mounted], scope: containerRef });

  const line1 = "Trusted by the best";
  const line2 = "churches";

  const renderLine = (text: string, lineIndex: number) => {
    return (
      <div className="flex flex-wrap justify-center items-center gap-x-[0.25em] gap-y-0 text-center">
        {text.split(" ").map((word, wordIndex) => (
          <span 
            key={`${lineIndex}-${wordIndex}`} 
            className="inline-block whitespace-nowrap"
          >
            {word.split("").map((char, charIndex) => {
              const isAnimTarget = char.toLowerCase() === 'c' && text.toLowerCase().includes('churches');
              return (
                <span 
                  key={`${lineIndex}-${wordIndex}-${charIndex}`} 
                  className={`char inline-block ${isAnimTarget ? 'animate-stretch' : ''}`}
                  style={{ transformOrigin: "left center", willChange: isAnimTarget ? "transform, padding" : "auto" }}
                >
                  {char}
                </span>
              );
            })}
          </span>
        ))}
      </div>
    );
  };

  if (!mounted) return <section className="bg-black py-48 h-[600px]" />;

  return (
    <section className="bg-black py-32 md:py-48 flex flex-col items-center justify-center overflow-hidden" ref={containerRef}>
      <div className="container mx-auto px-6 text-center max-w-6xl">
        {/* Kinetic "Stretch & Push" Typography with Word Protection */}
        <h2 
          ref={titleRef}
          className="text-5xl md:text-7xl lg:text-9xl font-black tracking-tighter uppercase text-white mb-16 font-stretch perspective-[1000px] flex flex-col items-center gap-2"
        >
          {renderLine(line1, 1)}
          {renderLine(line2, 2)}
        </h2>
        
        <p className="text-white/40 text-lg md:text-xl font-medium mb-24 max-w-2xl mx-auto leading-relaxed">
          Powering the world&apos;s most innovative ministries with cinematic speed and precision.
        </p>

        {/* Locked 4-Logo Staggered Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-16 md:gap-24 lg:gap-32 w-full max-w-7xl mx-auto items-center justify-center min-h-[120px]">
          {activeLogos.map((logo, i) => (
            <div
              key={logo.name + i}
              ref={(el) => { logoRefs.current[i] = el; }}
              className="flex items-center justify-center perspective-[1000px] select-none"
            >
              <Image
                src={logo.src}
                alt={logo.name}
                width={320}
                height={128}
                className="h-16 md:h-20 lg:h-24 w-auto object-contain transition-all duration-500"
                draggable={false}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
