import Link from "next/link";
import { desktopDownloadPath } from "@/lib/download";

import { StaggeredMenu } from "@/components/StaggeredMenu";
import { HelpLink, SUPPORT_EMAIL } from "@/components/help/HelpCenter";

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

const FOOTER_LINKS = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "/#features" },
      { label: "Pricing", href: "/pricing" },
      { label: "Download", href: desktopDownloadPath },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "Sign in", href: "/sign-in" },
      { label: "Create an account", href: "/sign-up" },
      { label: "Dashboard", href: "/dashboard" },
    ],
  },
] as const;

export function Footer() {
  return (
    <footer className="border-t border-white/10 bg-background text-white">
      <div className="container mx-auto grid gap-12 px-6 py-16 md:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]">
        <div className="max-w-sm">
          <Link href="/" className="inline-flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/present-mark.svg" alt="" width={32} height={32} className="h-8 w-8 rounded-[9px]" />
            <span className="text-lg font-bold tracking-tight">Present</span>
          </Link>
          <p className="mt-4 text-sm leading-6 text-white/50">
            Presentation software for churches, conferences and live events. Songs, scripture and media on every screen,
            with your whole team, online or off.
          </p>
          <Link
            href={desktopDownloadPath}
            className="mt-6 inline-flex h-10 items-center rounded-full bg-white px-5 text-sm font-semibold text-black transition hover:bg-white/90"
          >
            Download Present
          </Link>
        </div>

        {FOOTER_LINKS.map((group) => (
          <nav key={group.title} aria-label={group.title}>
            <p className="text-sm font-semibold">{group.title}</p>
            <ul className="mt-4 space-y-3 text-sm">
              {group.links.map((link) => (
                <li key={link.label}>
                  <Link href={link.href} className="text-white/50 transition hover:text-white">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}

        <nav aria-label="Support">
          <p className="text-sm font-semibold">Support</p>
          <ul className="mt-4 space-y-3 text-sm">
            <li>
              <HelpLink className="text-white/50 transition hover:text-white">Help and answers</HelpLink>
            </li>
            <li>
              <a href={`mailto:${SUPPORT_EMAIL}`} className="break-all text-white/50 transition hover:text-white">
                {SUPPORT_EMAIL}
              </a>
            </li>
          </ul>
        </nav>
      </div>

      <div className="border-t border-white/10">
        <div className="container mx-auto flex flex-col gap-2 px-6 py-6 text-sm text-white/40 sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; {new Date().getFullYear()} Present. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
