import type { PageLoadMeta } from "../lib/page-snapshots";
import styles from "../app/page.module.css";

export function SnapshotNotice({ meta }: { meta?: PageLoadMeta }) {
  if (!meta || meta.source === "snapshot") return null;
  const message =
    meta.source === "unavailable"
      ? meta.error ?? "Metrics unavailable — worker snapshot refresh pending."
      : meta.error ?? "Showing live data (snapshots stale). Pool pressure possible.";
  return (
    <p className={styles.warn} style={{ marginBottom: "1rem", maxWidth: "48rem" }}>
      {message}
      {meta.stale ? " Snapshot is stale." : ""}
    </p>
  );
}
