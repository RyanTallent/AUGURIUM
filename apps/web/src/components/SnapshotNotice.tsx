import type { PageLoadMeta } from "../lib/page-snapshots";
import styles from "../app/page.module.css";

export function SnapshotNotice({ meta }: { meta?: PageLoadMeta }) {
  if (!meta) return null;
  if (meta.source === "snapshot" && !meta.stale) return null;
  const message =
    meta.source === "unavailable"
      ? meta.error ?? "Metrics unavailable — worker snapshot refresh pending."
      : meta.stale
        ? `Showing cached data (${meta.snapshot?.ageMs ? `${Math.round(meta.snapshot.ageMs / 60000)}m old` : "stale"}). Refresh in progress.`
        : meta.error ?? "Showing live data. Pool pressure possible.";
  return (
    <p className={styles.warn} style={{ marginBottom: "1rem", maxWidth: "48rem" }}>
      {message}
      {meta.stale ? " Snapshot is stale." : ""}
    </p>
  );
}
