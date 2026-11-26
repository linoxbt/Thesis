"use client";

/**
 * The share card for a call, drawn in the browser (the site is a static
 * export, so there is no image server): 1200×630 PNG, the size X and every
 * other link preview uses. Everything on it comes from the chain.
 */
export interface CardData {
  side: "long" | "short";
  asset: string;
  entry: string;
  tp: string;
  movePct: string;
  deadline: string;
  crowdYes: string;
  openOdds: string;
  pot: string;
  creator: string;
  status: string;
  text?: string;
}

const W = 1200;
const H = 630;
const C = {
  bg: "#f4f2ec",
  panel: "#ffffff",
  ink: "#16171b",
  muted: "#6b6a64",
  faint: "#a3a19a",
  line: "#e4e1d8",
  brand: "#ff6a3d",
  yes: "#1f9e6a",
  bad: "#d64545",
};

// The Thesis mark (viewBox 4 5 40 40): bar, stem and the orange dot.
const BAR = "M5 8.5A1.5 1.5 0 0 1 6.5 7H41.5A1.5 1.5 0 0 1 43 8.5V12.5A1.5 1.5 0 0 1 41.5 14H30.708A7 7 0 0 0 17.292 14H6.5A1.5 1.5 0 0 1 5 12.5Z";
const STEM = "M19.5 21.362A7 7 0 0 0 28.5 21.362V41.5A1.5 1.5 0 0 1 27 43H21A1.5 1.5 0 0 1 19.5 41.5Z";

function mark(g: CanvasRenderingContext2D, x: number, y: number, size: number) {
  g.save();
  g.translate(x, y);
  g.scale(size / 40, size / 40);
  g.translate(-4, -5);
  g.fillStyle = C.ink;
  g.fill(new Path2D(BAR));
  g.fill(new Path2D(STEM));
  g.fillStyle = C.brand;
  g.beginPath();
  g.arc(24, 16, 4.5, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** Shrinks text to fit `max` px wide. */
function fit(g: CanvasRenderingContext2D, text: string, font: (px: number) => string, px: number, max: number) {
  let p = px;
  g.font = font(p);
  while (g.measureText(text).width > max && p > 12) g.font = font((p -= 2));
  return p;
}

export async function drawCard(d: CardData): Promise<Blob> {
  await Promise.all(
    ["600 64px Sora", "400 28px Inter", "500 28px 'JetBrains Mono'"].map((f) => document.fonts.load(f).catch(() => null)),
  );
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d")!;
  const sora = (px: number) => `600 ${px}px Sora, Inter, sans-serif`;
  const inter = (px: number) => `400 ${px}px Inter, sans-serif`;
  const mono = (px: number) => `500 ${px}px 'JetBrains Mono', ui-monospace, monospace`;

  g.fillStyle = C.bg;
  g.fillRect(0, 0, W, H);
  // Soft brand glow, top right.
  const glow = g.createRadialGradient(1050, 60, 10, 1050, 60, 520);
  glow.addColorStop(0, "rgba(255,106,61,0.18)");
  glow.addColorStop(1, "rgba(255,106,61,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);

  // Header: mark, wordmark, status.
  mark(g, 64, 52, 44);
  g.fillStyle = C.ink;
  g.font = sora(30);
  g.fillText("Thesis", 122, 86);
  g.font = mono(20);
  g.fillStyle = C.muted;
  g.textAlign = "right";
  g.fillText(d.status.toUpperCase(), W - 64, 84);
  g.textAlign = "left";

  // Side pill + pair.
  const long = d.side === "long";
  g.font = mono(24);
  const pill = long ? "LONG" : "SHORT";
  const pw = g.measureText(pill).width + 36;
  roundRect(g, 64, 140, pw, 48, 10);
  g.fillStyle = long ? "rgba(31,158,106,0.12)" : "rgba(214,69,69,0.12)";
  g.fill();
  g.fillStyle = long ? C.yes : C.bad;
  g.fillText(pill, 82, 173);
  g.fillStyle = C.ink;
  g.font = sora(64);
  g.fillText(`${d.asset} / USDT`, 64 + pw + 24, 186);

  // Levels panel.
  roundRect(g, 64, 226, W - 128, 170, 24);
  g.fillStyle = C.panel;
  g.fill();
  g.strokeStyle = C.line;
  g.lineWidth = 2;
  g.stroke();
  const cols = [
    { k: "ENTRY", v: d.entry, c: C.ink },
    { k: "TAKE PROFIT", v: d.tp, c: long ? C.yes : C.bad, sub: d.movePct },
    { k: "DEADLINE", v: d.deadline, c: C.ink },
  ];
  const cw = (W - 128) / 3;
  cols.forEach((col, i) => {
    const x = 64 + i * cw + 36;
    g.font = mono(18);
    g.fillStyle = C.faint;
    g.fillText(col.k, x, 280);
    g.fillStyle = col.c;
    fit(g, col.v, mono, 40, cw - 60);
    g.fillText(col.v, x, 336);
    if (col.sub) {
      g.font = mono(20);
      g.fillText(col.sub, x, 372);
    }
  });

  // Odds row.
  g.font = inter(24);
  g.fillStyle = C.muted;
  g.fillText("Crowd says", 64, 460);
  g.font = sora(52);
  g.fillStyle = C.ink;
  g.fillText(d.crowdYes, 64, 520);
  const cx = 64 + g.measureText(d.crowdYes).width + 28;
  g.font = inter(24);
  g.fillStyle = C.muted;
  g.fillText(`YES · opened at ${d.openOdds} · pot ${d.pot} QUSDC`, cx, 517);

  // The creator's reason, if any (one line).
  if (d.text) {
    g.fillStyle = C.muted;
    fit(g, `“${d.text}”`, inter, 24, W - 128);
    let t = `“${d.text}”`;
    while (g.measureText(t).width > W - 128 && t.length > 4) t = t.slice(0, -2) + "…”";
    g.fillText(t, 64, 566);
  }

  // Footer: the site on the right, the creator (shrunk, then cut, to fit) on the left.
  g.font = mono(20);
  const site = "thesis-qie.netlify.app · back it or challenge it on QIE";
  const siteW = g.measureText(site).width;
  g.textAlign = "right";
  g.fillStyle = C.ink;
  g.fillText(site, W - 64, 604);
  g.textAlign = "left";
  g.fillStyle = C.faint;
  const room = W - 128 - siteW - 32;
  let by = `by ${d.creator}`;
  fit(g, by, mono, 20, room);
  while (g.measureText(by).width > room && by.length > 6) by = by.slice(0, -2) + "…";
  g.fillText(by, 64, 604);
  g.fillStyle = C.brand;
  g.fillRect(0, H - 8, W, 8);

  return new Promise((resolve, reject) => cv.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas"))), "image/png"));
}
