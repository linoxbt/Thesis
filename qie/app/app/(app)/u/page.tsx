"use client";

import { PenLine } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { isAddress, type Address } from "viem";
import { ProfileStats } from "@/components/ProfileStats";
import { Avatar } from "@/components/ThesisCard";
import { explorerAddress } from "@/lib/config";
import { shortAddr } from "@/lib/format";
import { useWallet } from "@/lib/wallet";

export default function PublicProfilePage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Reading from QIE…</p>}>
      <PublicProfile />
    </Suspense>
  );
}

/** Public profile of any wallet. Your own, with positions and claims, is at /profile/. */
function PublicProfile() {
  const a = useSearchParams().get("a");
  const w = useWallet();
  if (!a || !isAddress(a)) return <p className="text-sm text-muted">That isn&apos;t a QIE address.</p>;
  const who = a as Address;
  const mine = !!w.account && w.account.toLowerCase() === who.toLowerCase();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar addr={who} size={56} />
          <div className="min-w-0">
            <span className="label">Profile</span>
            <h1 className="display num mt-1 truncate text-4xl">{shortAddr(who)}</h1>
            <div className="num mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted">
              <a href={explorerAddress(who)} target="_blank" rel="noreferrer" className="underline decoration-line-2 underline-offset-4 hover:text-ink">
                {who}
              </a>
            </div>
          </div>
        </div>
        {mine && (
          <Link href="/profile/" className="btn btn-ghost text-sm">
            <PenLine size={14} /> Your positions
          </Link>
        )}
      </div>
      <ProfileStats who={who} />
    </div>
  );
}
