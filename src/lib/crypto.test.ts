import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decrypt, encrypt } from "./crypto";

const originalEncryptionKey = process.env.ENCRYPTION_KEY;

beforeAll(() => {
  process.env.ENCRYPTION_KEY = "11".repeat(32);
});

afterAll(() => {
  if (originalEncryptionKey === undefined) {
    delete process.env.ENCRYPTION_KEY;
  } else {
    process.env.ENCRYPTION_KEY = originalEncryptionKey;
  }
});

describe("AES-256-GCM credential encryption", () => {
  it("round-trips ciphertext with the full authentication tag", () => {
    const ciphertext = encrypt("sk-private-value");

    expect(decrypt(ciphertext)).toBe("sk-private-value");
  });

  it("rejects a truncated authentication tag", () => {
    const [iv, tag, ciphertext] = encrypt("sk-private-value").split(":");
    const truncatedTag = Buffer.from(tag, "base64")
      .subarray(0, 12)
      .toString("base64");

    expect(() => decrypt(`${iv}:${truncatedTag}:${ciphertext}`)).toThrow();
  });
});
