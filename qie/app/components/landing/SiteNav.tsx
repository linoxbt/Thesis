"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { LogoMark } from "../Brand";

const LINKS = [
  ["How it works", "#how"],
  ["Proof", "#proof"],
  ["Markets", "#markets"],
  ["FAQ", "#faq"],
] as const;

/** Black notched tab pinned to the top edge, over the colour field. */
export function SiteNav() {
  return (
    <header className="fixed inset-x-0 top-0 z-40 flex justify-center px-2">
      <div className="notch flex w-full max-w-[1320px] items-center justify-between bg-[#050506] px-14 py-3 text-white sm:px-20">
        <Link href="/" className="flex items-center gap-2" aria-label="Thesis home">
          <LogoMark size={22} className="text-white" />
          <span className="font-display text-[19px] font-semibold tracking-[-0.03em]">Thesis</span>
        </Link>
        <nav className="hidden items-center gap-8 text-[15px] text-white/60 md:flex">
          {LINKS.map(([label, href]) => (
            <a key={href} href={href} className="transition-colors hover:text-white">
              {label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/app/"
            className="inline-flex items-center gap-1 rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-black transition-colors hover:bg-white/85"
            data-testid="launch-app"
          >
            Launch app <ArrowUpRight size={14} />
          </Link>
        </div>
      </div>
    </header>
  );
}
