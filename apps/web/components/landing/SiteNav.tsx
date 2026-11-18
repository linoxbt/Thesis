"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "../Brand";
import { ThemeToggle } from "../ThemeToggle";

const LINKS = [
  ["How it works", "#how"],
  ["Markets", "#markets"],
  ["Proof", "#proof"],
  ["FAQ", "#faq"],
] as const;

export function SiteNav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header
      className={
        "sticky top-0 z-30 transition-colors " + (scrolled ? "border-b border-line bg-bg/80 backdrop-blur-md" : "border-b border-transparent")
      }
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5 lg:px-8">
        <Logo />
        <nav className="hidden items-center gap-7 text-sm text-muted md:flex">
          {LINKS.map(([label, href]) => (
            <a key={href} href={href} className="transition-colors hover:text-ink">
              {label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link href="/app" className="btn btn-primary text-sm" data-testid="launch-app">
            Launch app <ArrowUpRight size={14} />
          </Link>
        </div>
      </div>
    </header>
  );
}
