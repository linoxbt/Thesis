import type { Metadata } from "next";
import type { ReactNode } from "react";

/** Link previews (X, Telegram, iMessage) unfurl into the trade's share card. */
export async function generateMetadata({ params }: { params: Promise<{ pda: string }> }): Promise<Metadata> {
  const { pda } = await params;
  const image = { url: `/api/og/thesis/${pda}`, width: 1200, height: 630, alt: "Thesis trade card" };
  const title = "A trade on Thesis: back it or challenge it";
  const description = "A SOL position posted as a live market. Back the take profit, challenge it, or cover the liquidation.";
  return {
    title,
    description,
    openGraph: { title, description, images: [image], type: "website" },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}

export default function ThesisLayout({ children }: { children: ReactNode }) {
  return children;
}
