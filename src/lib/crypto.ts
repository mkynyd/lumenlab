import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // NIST 800-38D: 96-bit IV for GCM

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length < 64) {
    throw new Error(
      "ENCRYPTION_KEY must be a 64-character hex string (32 bytes)"
    );
  }
  return Buffer.from(key, "hex");
}

/**
 * Encrypt plaintext with AES-256-GCM.
 * Returns "iv:tag:ciphertext" (all base64-encoded).
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");
  const tag = cipher.getAuthTag();

  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted}`;
}

/**
 * Decrypt a value produced by encrypt().
 * Input format: "iv:tag:ciphertext" (all base64-encoded).
 */
export function decrypt(combined: string): string {
  const key = getEncryptionKey();
  const parts = combined.split(":");

  if (parts.length !== 3) {
    throw new Error("Invalid encrypted data format");
  }

  const [ivB64, tagB64, ciphertext] = parts;

  if (!ivB64 || !tagB64 || !ciphertext) {
    throw new Error("Invalid encrypted data: missing iv, tag, or ciphertext");
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));

  let decrypted = decipher.update(ciphertext, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

/**
 * Mask an API key for display.
 * Example: "sk-abc123def456" → "sk-********f456"
 */
export function maskApiKey(key: string): string {
  if (key.length <= 8) {
    return key.slice(0, 3) + "*".repeat(key.length - 3);
  }
  const prefix = key.startsWith("sk-") ? "sk-" : "";
  const rest = key.slice(prefix.length);
  return prefix + "*".repeat(Math.min(rest.length - 4, 12)) + rest.slice(-4);
}
