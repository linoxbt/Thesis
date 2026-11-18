import { ImageResponse } from "next/og";
import { thesisDetail } from "@thesis/db";
import { bad, db, pubkey } from "@/lib/server";
import { MARK_PATHS } from "@/components/Brand";

export const dynamic = "force-dynamic";

const usd = (v: unknown, expo: number) => "$" + (Number(v) * 10 ** expo).toFixed(2);

/** GET /api/og/thesis/:pda — 1200x630 share card for X. */
export async function GET(_req: Request, { params }: { params: Promise<{ pda: string }> }) {
  const { pda } = await params;
  if (!pubkey(pda)) return bad("not a valid address");
  const d = await thesisDetail(db(), pda);
  if (!d || !d.conviction) return bad("thesis not found", 404);
  const c = d.conviction as Record<string, unknown>;
  const t = d.thesis as Record<string, unknown>;
  const yes = Number(c.yes_price_bps ?? c.initial_price_bps) / 100;
  const by = new Date(Number(t.end_ts) * 1000).toUTCString().slice(5, 22);
  const call = "SOL " + (c.direction === "above" ? "↑ " : "↓ ") + usd(c.strike, Number(c.expo)) + " by " + by + " UTC";
  const outcome = Number(t.outcome);
  const creator = String(t.creator);
  const name =
    (d.creator.profile as { display_name?: string } | null)?.display_name ?? creator.slice(0, 4) + "…" + creator.slice(-4);
  const tag = outcome === 1 ? "CALLED IT" : outcome === 2 ? "MISSED IT" : "BACK IT OR CHALLENGE IT";
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 64,
          background: "radial-gradient(70% 50% at 50% 0%, #2a160e 0%, #0c0d10 70%)",
          color: "#f3f1ea",
          fontFamily: "monospace",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", fontSize: 28, color: "#a9a69d", letterSpacing: 2 }}>
          <svg width="44" height="44" viewBox="4 5 40 40" style={{ marginRight: 16 }}>
            <path d={MARK_PATHS.bar} fill="#f3f1ea" />
            <path d={MARK_PATHS.stem} fill="#f3f1ea" />
            <circle cx={24} cy={16} r={4.5} fill="#ff6a3d" />
          </svg>
          {"THESIS · " + name}
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 64, fontWeight: 700 }}>{call}</div>
          {t.text ? (
            <div style={{ display: "flex", fontSize: 32, color: "#a9a69d", marginTop: 16 }}>
              {String(t.text).slice(0, 120)}
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ display: "flex", fontSize: 96, color: "#3ecf8e" }}>{yes.toFixed(0) + "% YES"}</div>
          <div style={{ display: "flex", fontSize: 32, color: d.protection ? "#7aa2ff" : "#a9a69d" }}>
            {(d.protection ? "PROTECTED · " : "") + tag}
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
