/** Placeholder until the Phase 4 screens land. The API is live under /api. */
export default function Home() {
  return (
    <main style={{ padding: 32, maxWidth: 640 }}>
      <h1 style={{ fontFamily: "monospace" }}>Thesis</h1>
      <p>Post your trade. The crowd bets on it. Your downside is covered by a price proof anyone can submit.</p>
      <p style={{ color: "#8b939c" }}>
        API: <code>/api/theses</code>, <code>/api/theses/:pda</code>, <code>/api/profiles/:wallet</code>,{" "}
        <code>/api/stats</code>, <code>/api/prove/:market</code>, <code>/api/og/thesis/:pda</code>,{" "}
        <code>/api/faucet</code>
      </p>
    </main>
  );
}
