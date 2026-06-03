import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AUGURIUM",
  description: "Prediction Market Intelligence Platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <nav
          style={{
            display: "flex",
            gap: "1.25rem",
            padding: "0.75rem 1.5rem",
            borderBottom: "1px solid var(--border)",
            fontSize: "0.85rem",
          }}
        >
          <a href="/">Dashboard</a>
          <a href="/overview">Overview</a>
          <a href="/markets">Markets</a>
          <a href="/signals">Signals</a>
          <a href="/traders">Traders</a>
          <a href="/shadow">Shadow</a>
          <a href="/shadow/analytics">Shadow analytics</a>
          <a href="/shadow/anomalies">Anomalies</a>
          <a href="/signals/validation">Signal validation</a>
          <a href="/readiness">Readiness</a>
          <a href="/simulations">Simulations</a>
          <a href="/replay">Replay</a>
          <a href="/portfolio">Portfolio</a>
          <a href="/risk">Risk</a>
          <a href="/allocations">Allocations</a>
          <a href="/execution">Execution</a>
          <a href="/reports">Reports</a>
        </nav>
        {children}
      </body>
    </html>
  );
}
