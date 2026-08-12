import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_CLOCK_SKEW_MS = 5 * 60_000;

export function isAdminObservabilityTimestampFresh(
  timestamp: string,
  now = Date.now()
): boolean {
  if (!/^\d{13}$/.test(timestamp)) return false;
  const value = Number(timestamp);
  return Number.isFinite(value) && Math.abs(now - value) <= MAX_CLOCK_SKEW_MS;
}

export function adminObservabilitySignature(input: {
  method: string;
  path: string;
  body: string;
  timestamp: string;
  nonce: string;
  secret: string;
}): string {
  return createHmac("sha256", input.secret)
    .update(
      `${input.timestamp}.${input.nonce}.${input.method.toUpperCase()}.${input.path}.${input.body}`
    )
    .digest("hex");
}

export function verifyAdminObservabilitySignature(
  input: Parameters<typeof adminObservabilitySignature>[0] & { signature: string }
): boolean {
  if (
    !input.secret ||
    !input.timestamp ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(input.nonce) ||
    !/^[a-f0-9]{64}$/i.test(input.signature)
  ) {
    return false;
  }
  const expected = Buffer.from(adminObservabilitySignature(input), "hex");
  const provided = Buffer.from(input.signature, "hex");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
