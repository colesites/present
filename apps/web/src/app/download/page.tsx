import type { Metadata } from "next";
import {
  ChevronDown,
} from "lucide-react";
import { FaApple, FaLinux, FaWindows } from "react-icons/fa6";
import { Footer, Navbar } from "@/components/home/Layout";
import {
  getDesktopDownloadTargets,
  type DesktopDownloadTarget,
} from "@/lib/download.server";

export const metadata: Metadata = {
  title: "Download Present Desktop",
  description:
    "Download Present for macOS, Windows, and Linux. Built for worship teams that need fast scripture search, stable stage output, and cloud-synced presentation control.",
};

const platformIcons = {
  mac: FaApple,
  windows: FaWindows,
  linux: FaLinux,
} as const;

function DownloadPlatformButton({ target }: { target: DesktopDownloadTarget }) {
  const Icon = platformIcons[target.platform];
  const isAvailable = target.availability === "available";

  const content = (
    <>
      <Icon className="h-7 w-7 text-black shrink-0" />
      <span className="text-[1.35rem] font-bold tracking-tight text-black flex-1 text-center">{target.label}</span>
      {target.platform !== "mac" ? (
         <ChevronDown className="h-6 w-6 text-black shrink-0" />
      ) : (
         <div className="h-6 w-6 shrink-0" />
      )}
    </>
  );

  const baseClasses = "group flex items-center justify-between w-full min-w-[13rem] max-w-[14.5rem] rounded-[20px] px-6 py-4 transition-transform duration-200";

  if (!isAvailable) {
    return (
      <div className={`${baseClasses} bg-white opacity-50`}>
        {content}
      </div>
    );
  }

  return (
    <a
      href={target.downloadPath}
      className={`${baseClasses} bg-white hover:scale-[1.03]`}
    >
      {content}
    </a>
  );
}

export default function DownloadPage() {
  const targets = getDesktopDownloadTargets();

  return (
    <div className="min-h-screen bg-[#000000] text-foreground selection:bg-[#5865F2]/30">
      <Navbar />

      <main className="overflow-hidden min-h-screen flex items-center justify-center pt-24 pb-12">
        <section className="relative w-full px-6 lg:px-12">
          {/* subtle background styling avoiding over-cluttering */}
          <div className="pointer-events-none absolute left-1/2 top-24 h-[32rem] w-[32rem] -translate-x-1/2 rounded-full bg-white/5 blur-[120px]" />

          <div className="container relative z-10 mx-auto flex flex-col items-center justify-center text-center max-w-[85rem]">
            
            {/* Main Content */}
            <div className="w-full max-w-4xl pt-10 flex flex-col items-center">
              <h1 className="font-stretch text-[3.8rem] leading-[0.95] font-black tracking-tight text-white sm:text-[5rem] lg:text-[6.5rem] uppercase text-center">
                Download
                <br />
                for Desktop
              </h1>

              <p className="mt-8 max-w-[36rem] text-lg leading-relaxed text-white sm:text-[1.3rem] font-medium text-center">
                Present keeps worship teams fast under pressure with cloud-synced libraries, instant scripture search, browser output, and a clean confidence view built for live services.
              </p>

              <div className="mt-12 flex flex-wrap justify-center gap-5 w-full max-w-3xl">
                {targets.map((target) => (
                  <DownloadPlatformButton
                    key={target.platform}
                    target={target}
                  />
                ))}
              </div>
            </div>

          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
