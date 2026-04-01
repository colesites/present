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
    <div className="grid h-9 w-9 grid-cols-2 gap-[2px]">
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
      className="flex items-center justify-between gap-4 px-7 py-6 text-left transition-colors duration-200 hover:bg-black/[0.035]"
    >
      <span className="text-[1.05rem] font-medium tracking-tight text-black/62">
        {variant.label}
      </span>
      <ArrowDownToLine className="h-6 w-6 shrink-0 text-black/58" />
    </a>
  );
}

function DownloadPlatformCard({ target }: { target: DesktopDownloadTarget }) {
  const Icon = platformIcons[target.platform];
  const isAvailable = target.availability === "available";

  if (!isAvailable) {
    return (
      <div className="w-full max-w-[29rem] overflow-hidden rounded-[26px] border border-black/10 bg-white opacity-50 shadow-[0_30px_80px_rgba(0,0,0,0.12)]">
        <div className="flex items-center gap-5 px-7 py-9">
          <Icon className="h-10 w-10 shrink-0 text-black" />
          <h2 className="text-[2.3rem] font-semibold tracking-tight text-black">
            {target.label}
          </h2>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[29rem] overflow-hidden rounded-[26px] border border-black/10 bg-white shadow-[0_30px_80px_rgba(0,0,0,0.12)]">
      <div className="flex items-center gap-5 px-7 py-9">
        <Icon className="h-10 w-10 shrink-0 text-black" />
        <h2 className="text-[2.3rem] font-semibold tracking-tight text-black">
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

              <div className="mt-14 grid w-full max-w-[94rem] gap-6 lg:grid-cols-3">
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
