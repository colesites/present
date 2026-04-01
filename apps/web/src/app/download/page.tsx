import type { Metadata } from "next";
import { ArrowDownToLine } from "lucide-react";
import { FaApple, FaLinux } from "react-icons/fa6";
import { Footer, Navbar } from "@/components/home/Layout";
import {
  getDesktopDownloadTargets,
  type DesktopDownloadVariant,
  type DesktopDownloadTarget,
} from "@/lib/download.server";

export const metadata: Metadata = {
  title: "Download Present Desktop",
  description:
    "Download Present for macOS, Windows, and Linux. Built for worship teams that need fast scripture search, stable stage output, and cloud-synced presentation control.",
};

function WindowsMark() {
  return (
    <div className="grid h-8 w-8 grid-cols-2 gap-[2px] sm:h-9 sm:w-9">
      <span className="bg-[#f25022]" />
      <span className="bg-[#7fba00]" />
      <span className="bg-[#00a4ef]" />
      <span className="bg-[#ffb900]" />
    </div>
  );
}

const platformIcons = {
  mac: FaApple,
  windows: WindowsMark,
  linux: FaLinux,
} as const;

function DownloadRow({ variant }: { variant: DesktopDownloadVariant }) {
  return (
    <a
      href={variant.downloadPath}
      className="flex items-center justify-between gap-4 px-5 py-4 text-left transition-colors duration-200 hover:bg-black/[0.035] sm:px-7 sm:py-6"
    >
      <span className="pr-3 text-[0.98rem] font-medium tracking-tight text-black/62 sm:text-[1.05rem]">
        {variant.label}
      </span>
      <ArrowDownToLine className="h-5 w-5 shrink-0 text-black/58 sm:h-6 sm:w-6" />
    </a>
  );
}

function DownloadPlatformCard({ target }: { target: DesktopDownloadTarget }) {
  const Icon = platformIcons[target.platform];
  const isAvailable = target.availability === "available";

  if (!isAvailable) {
    return (
      <div className="w-full overflow-hidden rounded-[22px] border border-black/10 bg-white opacity-50 shadow-[0_24px_60px_rgba(0,0,0,0.1)] sm:max-w-[29rem] sm:rounded-[26px] sm:shadow-[0_30px_80px_rgba(0,0,0,0.12)]">
        <div className="flex items-center gap-4 px-5 py-6 sm:gap-5 sm:px-7 sm:py-9">
          <Icon className="h-8 w-8 shrink-0 text-black sm:h-10 sm:w-10" />
          <h2 className="text-[1.9rem] font-semibold tracking-tight text-black sm:text-[2.3rem]">
            {target.label}
          </h2>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full overflow-hidden rounded-[22px] border border-black/10 bg-white shadow-[0_24px_60px_rgba(0,0,0,0.1)] sm:max-w-[29rem] sm:rounded-[26px] sm:shadow-[0_30px_80px_rgba(0,0,0,0.12)]">
      <div className="flex items-center gap-4 px-5 py-6 sm:gap-5 sm:px-7 sm:py-9">
        <Icon className="h-8 w-8 shrink-0 text-black sm:h-10 sm:w-10" />
        <h2 className="text-[1.9rem] font-semibold tracking-tight text-black sm:text-[2.3rem]">
          {target.label}
        </h2>
      </div>

      <div className="border-t border-black/10">
        {target.variants.map((variant, index) => (
          <div
            key={variant.slug}
            className={index === 0 ? "" : "border-t border-black/10"}
          >
            <DownloadRow variant={variant} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DownloadPage() {
  const targets = getDesktopDownloadTargets();

  return (
    <div className="min-h-screen bg-[#000000] text-foreground selection:bg-[#5865F2]/30">
      <Navbar />

      <main className="min-h-screen overflow-x-hidden pt-20 pb-12 sm:pt-24">
        <section className="relative w-full px-4 sm:px-6 lg:px-12">
          {/* subtle background styling avoiding over-cluttering */}
          <div className="pointer-events-none absolute left-1/2 top-16 h-[20rem] w-[20rem] -translate-x-1/2 rounded-full bg-white/5 blur-[90px] sm:top-24 sm:h-[32rem] sm:w-[32rem] sm:blur-[120px]" />

          <div className="container relative z-10 mx-auto flex max-w-[94rem] flex-col items-center text-center">
            
            {/* Main Content */}
            <div className="flex w-full flex-col items-center pt-8 sm:pt-10">
              <h1 className="font-stretch text-[2.6rem] leading-[0.95] font-black tracking-tight text-white sm:text-[5rem] lg:text-[6.5rem] uppercase text-center">
                Download
                <br />
                for Desktop
              </h1>

              <p className="mt-6 max-w-[34rem] px-2 text-[0.98rem] leading-relaxed text-white/88 sm:mt-8 sm:text-[1.3rem] sm:text-white font-medium text-center">
                Present keeps worship teams fast under pressure with cloud-synced libraries, instant scripture search, browser output, and a clean confidence view built for live services.
              </p>

              <div className="mt-10 grid w-full gap-4 sm:mt-14 sm:gap-6 lg:grid-cols-3">
                {targets.map((target) => (
                  <DownloadPlatformCard
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
