import {
  createHmac,
  generateKeyPairSync,
  randomBytes,
  type KeyObject,
} from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptSyncEnvelope,
  verifySyncSignature,
  type SyncEnvelope,
} from "@/lib/registration-sync-crypto";

describe("verifySyncSignature", () => {
  it("accepts the exact signed request and rejects body tampering", () => {
    const body = JSON.stringify({ publicationId: "publication-1" });
    const timestamp = "1781524800000";
    const nonce = "nonce-1";
    const secret = "sync-secret";
    const signature = createHmac("sha256", secret)
      .update(`${timestamp}.${nonce}.${body}`)
      .digest("hex");

    expect(
      verifySyncSignature({ body, timestamp, nonce, signature, secret })
    ).toBe(true);
    expect(
      verifySyncSignature({
        body: `${body} `,
        timestamp,
        nonce,
        signature,
        secret,
      })
    ).toBe(false);
  });
});

describe("decryptSyncEnvelope", () => {
  it("decrypts an RSA-wrapped AES-256-GCM snapshot", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const plaintext = JSON.stringify({
      publicationId: "publication-1",
      codes: [],
    });
    const envelope = await createTestEnvelope(plaintext, publicKey);

    expect(decryptSyncEnvelope(envelope, privateKey)).toBe(plaintext);
  });
});

async function createTestEnvelope(
  plaintext: string,
  publicKey: KeyObject
): Promise<SyncEnvelope> {
  const { createCipheriv, publicEncrypt, constants } = await import(
    "node:crypto"
  );
  const dataKey = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dataKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return {
    encryptedKey: publicEncrypt(
      {
        key: publicKey,
        oaepHash: "sha256",
        padding: constants.RSA_PKCS1_OAEP_PADDING,
      },
      dataKey
    ).toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}
