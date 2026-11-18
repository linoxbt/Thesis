import type { ReactNode } from "react";

export const metadata = {
  title: "Thesis",
  description: "Post your trade. The crowd bets on it. Your downside is covered by a price proof anyone can submit.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0b0d10", color: "#e6e8eb", fontFamily: "system-ui, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
