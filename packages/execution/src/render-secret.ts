import { existsSync, readFileSync } from "node:fs";

/** Env var first, then Render secret file at /etc/secrets/<name>. */
export function readConfigSecret(name: string): string | undefined {
  const fromEnv = process.env[name]?.trim();
  if (fromEnv) return fromEnv;

  for (const path of [`/etc/secrets/${name}`, `/etc/secrets/${name}.txt`]) {
    try {
      if (!existsSync(path)) continue;
      const value = readFileSync(path, "utf8").trim();
      if (value) return value;
    } catch {
      // ignore unreadable paths
    }
  }

  return undefined;
}

export function hasConfigSecret(name: string): boolean {
  return Boolean(readConfigSecret(name));
}
