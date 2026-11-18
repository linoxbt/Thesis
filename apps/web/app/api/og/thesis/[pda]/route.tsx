import { ImageResponse } from "next/og";
import { thesisDetail } from "@thesis/db";
import { bad, db, pubkey } from "@/lib/server";
import { MARK_PATHS } from "@/components/Brand";
import { fmtLev, fmtPct, positionOf } from "@/lib/position";

export const dynamic = "force-dynamic";

const usd2 = (v: number) => "$" + v.toFixed(2);
const SITE_HOST = (process.env.NEXT_PUBLIC_SITE_URL ?? process.env.URL ?? "https://thesis-calls.netlify.app").replace(/^https?:\/\//, "");

/**
 * GET /api/og/thesis/:pda — 1200x630 share card for X: the trade as a perp
 * position (side, implied leverage, entry, take profit, liquidation) and the
 * crowd's live odds. On settle it reads "Called it" or "Missed it".
 */
export async function GET(_req: Request, { params }: { params: Promise<{ pda: string }> }) {
  const { pda } = await params;
  if (!pubkey(pda)) return bad("not a valid address");
  const d = await thesisDetail(db(), pda);
  if (!d || !d.conviction) return bad("thesis not found", 404);
  const c = d.conviction as Record<string, unknown>;
  const pr = d.protection as Record<string, unknown> | null;
  const t = d.thesis as Record<string, unknown>;
  const expo = Number(c.expo);
  const px = (v: unknown) => Number(v) * 10 ** expo;
  const pos = positionOf(c.direction as "above" | "below", px(c.spot_at_open), px(c.strike), pr ? px(pr.strike) : null);
  const long = pos.side === "long";
  const yes = Number(c.yes_price_bps ?? c.initial_price_bps) / 100;
  const by = new Date(Number(t.end_ts) * 1000).toUTCString().slice(5, 22) + " UTC";
  const outcome = Number(t.outcome);
  const creator = String(t.creator);
  const name = (d.creator.profile as { display_name?: string } | null)?.display_name ?? creator.slice(0, 4) + "…" + creator.slice(-4);
  const tag = outcome === 1 ? "CALLED IT" : outcome === 2 ? "MISSED IT" : c.touched ? "TAKE PROFIT HIT" : "BACK IT OR CHALLENGE IT";
  const tagColor = outcome === 1 || c.touched ? "#3ecf8e" : outcome === 2 ? "#a9a69d" : "#ff6a3d";
  const sideColor = long ? "#3ecf8e" : "#ff6b6b";
  const text = t.text ? String(t.text).slice(0, 110) : null;
  const cell = (k: string, v: string, sub?: { text: string; color: string }) => (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <div style={{ display: "flex", fontSize: 22, color: "#75736c", letterSpacing: 3 }}>{k}</div>
      <div style={{ display: "flex", fontSize: 52, color: "#f3f1ea", marginTop: 8 }}>{v}</div>
      {sub ? <div style={{ display: "flex", fontSize: 24, color: sub.color, marginTop: 4 }}>{sub.text}</div> : <div style={{ display: "flex", height: 28 }} />}
    </div>
  );
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "52px 60px",
          background: "#0c0d10",
          color: "#f3f1ea",
          fontFamily: "sans-serif",
          borderTop: "10px solid #c93d14",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", fontSize: 28, color: "#a9a69d" }}>
            <svg width="42" height="42" viewBox="4 5 40 40" style={{ marginRight: 14 }}>
              <path d={MARK_PATHS.bar} fill="#f3f1ea" />
              <path d={MARK_PATHS.stem} fill="#f3f1ea" />
              <circle cx={24} cy={16} r={4.5} fill="#ff6a3d" />
            </svg>
            <span style={{ color: "#f3f1ea", fontWeight: 700, marginRight: 14 }}>Thesis</span>
            <span>{"· " + name}</span>
          </div>
          <div style={{ display: "flex", fontSize: 22, color: tagColor, letterSpacing: 3, border: `2px solid ${tagColor}`, borderRadius: 999, padding: "8px 20px" }}>{tag}</div>
        </div>

        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ display: "flex", fontSize: 44, fontWeight: 700, color: sideColor, background: long ? "rgba(62,207,142,0.12)" : "rgba(255,107,107,0.12)", border: `2px solid ${sideColor}`, borderRadius: 14, padding: "6px 22px", marginRight: 24 }}>
            {(long ? "LONG" : "SHORT") + (pos.lev !== null ? " " + fmtLev(pos.lev) : "")}
          </div>
          <div style={{ display: "flex", fontSize: 64, fontWeight: 700 }}>SOL / USD</div>
          <div style={{ display: "flex", fontSize: 26, color: "#75736c", marginLeft: 24 }}>{"until " + by}</div>
        </div>

        <div style={{ display: "flex" }}>
          {cell("ENTRY", usd2(pos.entry))}
          {cell("TAKE PROFIT", usd2(pos.tp), { text: fmtPct(pos.tpMovePct) + (pos.roeAtTp !== null ? ` · ${fmtPct(pos.roeAtTp, 0)} ROE` : ""), color: "#3ecf8e" })}
          {cell("LIQUIDATION", pos.liq !== null ? usd2(pos.liq) : "—", pos.liqMovePct !== null ? { text: fmtPct(pos.liqMovePct) + " · covered", color: "#7aa2ff" } : { text: "no cover", color: "#75736c" })}
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", borderTop: "2px solid #212228", paddingTop: 24 }}>
          <div style={{ display: "flex", flexDirection: "column", maxWidth: 700 }}>
            <div style={{ display: "flex", alignItems: "baseline" }}>
              <span style={{ fontSize: 64, fontWeight: 700, color: "#f3f1ea" }}>{yes.toFixed(0) + "%"}</span>
              <span style={{ fontSize: 26, color: "#a9a69d", marginLeft: 16 }}>crowd odds the take profit hits</span>
            </div>
            {text ? <div style={{ display: "flex", fontSize: 24, color: "#a9a69d", marginTop: 6 }}>{"“" + text + "”"}</div> : null}
          </div>
          <div style={{ display: "flex", fontSize: 22, color: "#75736c" }}>{SITE_HOST}</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
