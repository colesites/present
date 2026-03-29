import Link from "next/link";
import { Download, User, ChevronDown } from "lucide-react";
import { desktopDownloadPath } from "@/lib/download";

export function Navbar() {
  return (
    <header className="fixed top-0 w-full z-50 bg-black/80 backdrop-blur-md border-b border-white/5">
      <div className="container mx-auto flex h-16 items-center justify-between px-4 lg:px-8">
        {/* Left: Logo */}
        <Link href="/" className="flex items-center gap-2 group">
          <div className="h-7 w-7 rounded bg-primary flex items-center justify-center font-bold text-white text-base rounded-tl-lg rounded-br-lg shadow-[0_0_15px_rgba(var(--primary),0.5)] transition-transform group-hover:scale-105">
            P
          </div>
          <span className="text-lg font-bold tracking-tight text-white group-hover:text-primary transition-colors">Present</span>
        </Link>

        {/* Center: Navigation */}
        <nav className="hidden lg:flex items-center gap-1">
          <Link href="/" className="px-4 py-2 text-[13px] font-medium text-white/70 hover:text-white hover:bg-white/5 rounded-full transition-all">
            Home
          </Link>
          <div className="group relative">
            <button className="px-4 py-2 text-[13px] font-medium text-white/70 group-hover:text-white flex items-center gap-1 group-hover:bg-white/5 rounded-full transition-all">
              Features <ChevronDown className="w-3 h-3 opacity-50 group-hover:rotate-180 transition-transform" />
            </button>
            {/* Dropdown placeholder (optional but matches image) */}
            <div className="absolute top-full left-0 w-48 pt-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all">
              <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-2 shadow-2xl">
                 <Link href="#" className="block px-3 py-2 text-xs text-white/60 hover:text-white hover:bg-white/5 rounded-lg">Live Streaming</Link>
                 <Link href="#" className="block px-3 py-2 text-xs text-white/60 hover:text-white hover:bg-white/5 rounded-lg">Multi-Screen</Link>
                 <Link href="#" className="block px-3 py-2 text-xs text-white/60 hover:text-white hover:bg-white/5 rounded-lg">Stage Display</Link>
              </div>
            </div>
          </div>
          <Link href="#" className="px-4 py-2 text-[13px] font-medium text-white/70 hover:text-white hover:bg-white/5 rounded-full transition-all">
            Pricing
          </Link>
          <Link href="#" className="px-4 py-2 text-[13px] font-medium text-white/70 hover:text-white hover:bg-white/5 rounded-full transition-all flex items-center gap-2">
            Present Remote
            <span className="bg-primary/20 text-primary text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider border border-primary/30">NEW</span>
          </Link>
        </nav>

        {/* Right: Actions */}
        <div className="flex items-center gap-2 sm:gap-6">
          <Link
            href={desktopDownloadPath}
            className="hidden sm:flex items-center gap-1.5 text-[13px] font-medium text-white/70 hover:text-white transition-colors"
          >
            Download <Download className="w-3.5 h-3.5" />
          </Link>
          <Link href="/sign-in" className="flex items-center gap-1.5 text-[13px] font-medium text-white/70 hover:text-white transition-colors border-l border-white/10 pl-6 ml-2 sm:ml-0">
            Account <User className="w-3.5 h-3.5" />
          </Link>
          <Link 
            href="/sign-in" 
            className="hidden md:flex bg-white text-black text-[13px] font-bold px-5 py-2.5 rounded hover:bg-white/90 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-white/10 bg-background py-16 text-center text-muted-foreground">
      <div className="flex items-center justify-center gap-2 mb-4">
        <div className="h-6 w-6 rounded bg-primary flex items-center justify-center font-bold text-white text-xs">P</div>
        <span className="font-bold text-white tracking-tight">Present</span>
      </div>
      <p className="text-sm">© {new Date().getFullYear()} Present Software Inc. All rights reserved.</p>
    </footer>
  );
}
