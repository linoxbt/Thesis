"use client";

import { PenLine } from "lucide-react";
import Link from "next/link";
import { use } from "react";
import { Avatar } from "@/components/ThesisCard";
import { ProfileStats, type ProfileData } from "@/components/ProfileStats";
import { usePoll } from "@/lib/client/api";
import { explorerAccount } from "@/lib/client/config";
import { shortAddr } from "@/lib/client/format";
import { useActiveWallet } from "@/lib/client/wallet";

/** Public profile of any wallet. Your own, with editing, is at /profile. */
export default function PublicProfilePage({ params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = use(params);
  const active = useActiveWallet();
  const { data, error } = usePoll<ProfileData>(`/api/profiles/${wallet}`, 30_000);
  if (error) return <p className="text-sm text-bad">{error}</p>;
  if (!data) return <p className="text-sm text-muted">Loading…</p>;
  const mine = active?.publicKey.toBase58() === wallet;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar addr={wallet} size={56} />
          <div className="min-w-0">
            <span className="label">Profile</span>
            <h1 className="display mt-1 truncate text-4xl">{data.profile?.display_name ?? shortAddr(wallet)}</h1>
            <div className="num mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted">
              <a href={explorerAccount(wallet)} target="_blank" rel="noreferrer" className="underline decoration-line-2 underline-offset-4 hover:text-ink">
                {shortAddr(wallet)}
              </a>
              {data.profile?.x_handle && (
                <a href={`https://x.com/${data.profile.x_handle}`} target="_blank" rel="noreferrer" className="hover:text-ink">
                  @{data.profile.x_handle}
                </a>
              )}
            </div>
          </div>
        </div>
        {mine && (
          <Link href="/profile" className="btn btn-ghost text-sm">
            <PenLine size={14} /> Edit profile
          </Link>
        )}
      </div>
      <ProfileStats data={data} />
    </div>
  );
}
