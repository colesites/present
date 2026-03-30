import Link from "next/link";
import { desktopDownloadPath } from "@/lib/download";

import { StaggeredMenu } from "@/components/StaggeredMenu";

const Logo = () => (
  <Link href="/" className="flex items-center gap-2 group pointer-events-auto">
    <div className="h-7 w-7 rounded bg-primary flex items-center justify-center font-bold text-white text-base rounded-tl-lg rounded-br-lg shadow-[0_0_15px_rgba(var(--primary),0.5)] transition-transform group-hover:scale-105">
      P
    </div>
    <span className="text-lg font-bold tracking-tight text-white group-hover:text-primary transition-colors">Present</span>
  </Link>
);

export function Navbar() {
  const menuItems = [
    { label: "Home", ariaLabel: "Home", link: "/" },
    { label: "Features", ariaLabel: "Features", link: "#features" },
    { label: "Pricing", ariaLabel: "Pricing", link: "#pricing" },
    { label: "Download", ariaLabel: "Download", link: desktopDownloadPath },
    { label: "Account", ariaLabel: "Account", link: "/sign-in" },
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
