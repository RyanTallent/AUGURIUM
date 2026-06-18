"use client";

import { useState } from "react";

type SeedResponse = {
  walletAdded?: string;
  metricsFound?: boolean;
  positionsSynced?: number;
  usMatchConfidence?: number;
  leaderGatesPass?: boolean;
  gateReasons?: string[];
  error?: string;
};

export function WatchlistSeedForm() {
  const [token, setToken] = useState("");
  const [wallet, setWallet] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SeedResponse | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/copy/watchlist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({ wallet: wallet.trim(), notes: notes.trim() || undefined }),
      });
      const data = (await res.json()) as SeedResponse;
      if (!res.ok) {
        setResult({ error: data.error ?? `HTTP ${res.status}` });
      } else {
        setResult(data);
      }
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : "request failed" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section style={{ marginTop: "1.5rem", maxWidth: "36rem" }}>
      <h2 style={{ fontSize: "1rem" }}>Add wallet to US leader watchlist</h2>
      <p style={{ fontSize: "0.85rem", marginBottom: "0.75rem" }}>
        Seeds PolymarketScan metrics, syncs open positions, and evaluates US catalog match (≥90%) plus
        v1 leader gates. Requires <code>COPY_ADMIN_TOKEN</code> or <code>MAINTENANCE_ADMIN_TOKEN</code>{" "}
        on this web service.
      </p>
      <form onSubmit={onSubmit} style={{ display: "grid", gap: "0.75rem" }}>
        <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.85rem" }}>
          Admin token
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
            autoComplete="off"
            style={{ padding: "0.5rem", borderRadius: "4px", border: "1px solid var(--border, #333)" }}
          />
        </label>
        <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.85rem" }}>
          Wallet (0x…)
          <input
            type="text"
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            placeholder="0x89dd49bf87c41be422927372a0b75c6ab577f662"
            required
            pattern="0x[a-fA-F0-9]{40}"
            style={{ padding: "0.5rem", borderRadius: "4px", border: "1px solid var(--border, #333)" }}
          />
        </label>
        <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.85rem" }}>
          Notes (optional)
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="sports-mlb — 100% US BAL/SEA open"
            style={{ padding: "0.5rem", borderRadius: "4px", border: "1px solid var(--border, #333)" }}
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: "0.5rem 1rem",
            borderRadius: "4px",
            border: "none",
            cursor: loading ? "wait" : "pointer",
            background: "var(--accent, #4a9)",
            color: "#000",
            fontWeight: 600,
            width: "fit-content",
          }}
        >
          {loading ? "Seeding…" : "Add to watchlist"}
        </button>
      </form>
      {result && (
        <pre
          style={{
            marginTop: "1rem",
            background: "var(--surface)",
            padding: "1rem",
            borderRadius: "6px",
            fontSize: "0.8rem",
            overflow: "auto",
            whiteSpace: "pre-wrap",
          }}
        >
          {result.error
            ? result.error
            : JSON.stringify(result, null, 2)}
        </pre>
      )}
    </section>
  );
}
