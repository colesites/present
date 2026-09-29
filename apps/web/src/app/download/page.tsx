import type { Metadata } from "next";
import { Apple, ArrowDownToLine, Terminal } from "lucide-react";
import { HelpButton } from "@/components/help/HelpCenter";
import { Footer, Navbar } from "@/components/home/Layout";
import {
  getDesktopDownloadTargets,
  type DesktopDownloadVariant,
  type DesktopDownloadTarget,
} from "@/lib/download.server";
import {
  fetchReleaseManifest,
  humanSize,
  previousReleases,
  releaseDownloads,
  type Release,
  type ReleaseDownload,
} from "@/lib/releases";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Download Present Desktop",
  description:
    "Download Present for macOS, Windows, and Linux. Built for churches, conferences and live events that need fast scripture search, stable stage output, and cloud-synced presentation control.",
};

function WindowsMark({ className }: { className?: string }) {
  return (
    <div className={cn("grid h-8 w-8 grid-cols-2 gap-[2px] sm:h-9 sm:w-9", className)}>
      <span className="bg-[#f25022]" />
      <span className="bg-[#7fba00]" />
      <span className="bg-[#00a4ef]" />
      <span className="bg-[#ffb900]" />
    </div>
  );
}

const platformIcons = {
  mac: Apple,
  windows: WindowsMark,
  linux: Terminal,
} as const;

/**
 * One download. Its version is said here only when it is not the card's: a
 * Mac build for one chip can be out before the other.
 */
function DownloadRow({
  variant,
  cardVersion,
}: {
  variant: DesktopDownloadVariant;
  cardVersion: string | null;
}) {
  return (
    <a
      href={variant.downloadPath}
      className="flex items-center justify-between gap-4 px-5 py-4 text-left transition-colors duration-200 hover:bg-black/[0.035] sm:px-7 sm:py-6"
    >
      <span className="pr-3 text-[0.98rem] font-medium tracking-tight text-black/62 sm:text-[1.05rem]">
        {variant.label}
      </span>
      <span className="flex shrink-0 items-center gap-3">
        {variant.version && variant.version !== cardVersion ? (
          <span className="text-[0.82rem] tabular-nums text-black/45">{variant.version}</span>
        ) : null}
        <ArrowDownToLine className="h-5 w-5 shrink-0 text-black/58 sm:h-6 sm:w-6" />
      </span>
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
        <div className="text-left">
          <h2 className="text-[1.9rem] font-semibold tracking-tight text-black sm:text-[2.3rem]">
            {target.label}
          </h2>
          {/* Each platform's own: they are built and published one at a time. */}
          {target.version ? (
            <p className="mt-0.5 text-[0.85rem] font-medium tabular-nums text-black/45">
              Version {target.version}
            </p>
          ) : null}
        </div>
      </div>

      <div className="border-t border-black/10">
        {target.variants.map((variant, index) => (
          <div
            key={variant.slug}
            className={index === 0 ? "" : "border-t border-black/10"}
          >
            <DownloadRow variant={variant} cardVersion={target.version} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** One way to download an earlier release, or a note that it was not built. */
function PreviousDownload({ download }: { download: ReleaseDownload }) {
  const Icon = platformIcons[download.platform];
  const icon =
    download.platform === "windows" ? (
      <WindowsMark className="h-4 w-4 gap-px sm:h-4 sm:w-4" />
    ) : (
      <Icon className="h-[1.1rem] w-[1.1rem] text-white" />
    );

  if (download.size === null) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] px-4 py-3 opacity-45">
        {icon}
        <span className="text-[0.9rem] font-medium text-white/80">{download.label}</span>
        <span className="ml-auto text-[0.78rem] text-white/50">Not built</span>
      </div>
    );
  }

  return (
    <a
      href={download.path}
      className="group flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 transition hover:border-white/25 hover:bg-white/[0.08]"
    >
      {icon}
      <span className="text-[0.9rem] font-medium text-white">{download.label}</span>
      <span className="ml-auto text-[0.78rem] tabular-nums text-white/45">
        {humanSize(download.size)}
      </span>
      <ArrowDownToLine className="h-4 w-4 shrink-0 text-white/50 transition group-hover:text-white" />
    </a>
  );
}

/**
 * Everything published before the current release.
 *
 * A church that has standardised on a version, or one that hit a problem with
 * the newest, needs the one they had back, and a bucket cannot be browsed
 * from a page, so the list comes from the manifest. Each is offered the way
 * the current one is, by platform, at this site's own address rather than the
 * file's. Collapsed by default: it is a way out, not the thing most people
 * came for.
 */
function PreviousVersions({ releases }: { releases: Release[] }) {
  return (
    <details className="mt-12 w-full max-w-3xl text-left">
      <summary className="cursor-pointer list-none text-center text-[0.9rem] text-white/60 transition hover:text-white">
        Previous versions ({releases.length})
      </summary>
      <div className="mt-6 space-y-4">
        {releases.map((release) => (
          <div
            key={release.version}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[1rem] font-semibold text-white">
                Version {release.version}
              </span>
              <span className="text-[0.78rem] text-white/45">
                {new Date(release.publishedAt).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {releaseDownloads(release).map((download) => (
                <PreviousDownload key={download.slug} download={download} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

export default async function DownloadPage() {
  // The manifest the release job writes to R2. Downloads come from it, so a
  // release needs no redeploy; the environment variables answer only until
  // something has been published. Each download is the newest release's that
  // has it, so a platform not yet built for the newest keeps the one before.
  const manifest = await fetchReleaseManifest();
  const targets = getDesktopDownloadTargets(manifest);
  const previous = previousReleases(manifest);

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
              <h1 className="font-stretch text-[1.75rem] leading-[0.95] font-black tracking-tight text-white sm:text-[4rem] lg:text-[6.5rem] uppercase text-center">
                Download
                <br />
                for Desktop
              </h1>

              <p className="mt-6 max-w-[34rem] px-2 text-[0.98rem] leading-relaxed text-white/88 sm:mt-8 sm:text-[1.3rem] sm:text-white font-medium text-center">
                Present keeps a team fast under pressure: cloud-synced libraries, instant scripture search, browser output, and a clean confidence view built for anything running live.
              </p>

              <div className="mt-10 grid w-full gap-4 sm:mt-14 sm:gap-6 lg:grid-cols-3">
                {targets.map((target) => (
                  <DownloadPlatformCard
                    key={target.platform}
                    target={target}
                  />
                ))}
              </div>

              {previous.length > 0 ? <PreviousVersions releases={previous} /> : null}
            </div>

          </div>
        </section>
      </main>

      <Footer />
      <HelpButton />
    </div>
  );
}
