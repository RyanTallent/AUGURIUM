const SECRET_KEYS = [
  "privateKey",
  "private_key",
  "POLYMARKET_PRIVATE_KEY",
  "apiSecret",
  "api_secret",
  "POLYMARKET_API_SECRET",
  "passphrase",
  "POLYMARKET_API_PASSPHRASE",
];

/** Never log secrets — redact from strings and objects. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const key of SECRET_KEYS) {
    out = out.replace(new RegExp(`${key}[=:]\\s*[^\\s,}]+`, "gi"), `${key}=[REDACTED]`);
  }
  return out;
}

export function safeLogMessage(message: string): string {
  return redactSecrets(message);
}
