import Link from "next/link";
import { desktopDownloadPath } from "@/lib/download";

import { StaggeredMenu } from "@/components/StaggeredMenu";

const Logo = () => (
  <Link href="/" className="flex items-center gap-3 group pointer-events-auto">
    <img
      src="/present-mark.svg"
      alt="Present"
      width={40}
      height={40}
      className="h-10 w-10 rounded-[11px] shadow-[0_0_22px_rgba(82,39,255,0.45)] transition-transform group-hover:scale-105"
    />
    <span className="text-2xl font-bold tracking-tight text-white group-hover:text-primary transition-colors">Present</span>
  </Link>
);

export function Navbar() {
  const menuItems = [
    { label: "Home", ariaLabel: "Home", link: "/" },
    { label: "Features", ariaLabel: "Features", link: "#features" },
    { label: "Testimonials", ariaLabel: "Testimonials", link: "#testimonials" },
    { label: "Pricing", ariaLabel: "Pricing", link: "#pricing" },
    { label: "Download", ariaLabel: "Download", link: desktopDownloadPath },
    { label: "Sign in", ariaLabel: "Sign in", link: "/sign-in" },
  ];

  const socialItems = [
    { label: "Twitter", link: "https://twitter.com" },
    { label: "Instagram", link: "https://instagram.com" },
    { label: "TikTok", link: "https://tiktok.com" },
  ];

  return (
    <StaggeredMenu 
      logo={<Logo />}
      items={menuItems}
      socialItems={socialItems}
      position="right"
      isFixed={true} 
      accentColor="#5227FF"
      colors={['#0a0a10', '#5227FF']}
      menuButtonColor="#fff"
      openMenuButtonColor="#fff"
      displayItemNumbering={true}
    />
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
