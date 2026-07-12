import {
  constants,
  createDecipheriv,
  createHmac,
  privateDecrypt,
  timingSafeEqual,
  type KeyLike,
} from "node:crypto";

export type SyncEnvelope = {
  encryptedKey: string;
  iv: string;
  authTag: string;
  ciphertext: string;
};

type VerifySyncSignatureInput = {
  body: string;
  timestamp: string;
  nonce: string;
  signature: string;
  secret: string;
};

export function verifySyncSignature({
  body,
  timestamp,
  nonce,
  signature,
  secret,
}: VerifySyncSignatureInput): boolean {
  if (!body || !timestamp || !nonce || !signature || !secret) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${nonce}.${body}`)
    .digest();

  let provided: Buffer;
  try {
    provided = Buffer.from(signature, "hex");
  } catch {
    return false;
  }

  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function decryptSyncEnvelope(
  envelope: SyncEnvelope,
  privateKey: KeyLike
): string {
  const dataKey = privateDecrypt(
    {
      key: privateKey,
      oaepHash: "sha256",
      padding: constants.RSA_PKCS1_OAEP_PADDING,
    },
    Buffer.from(envelope.encryptedKey, "base64")
  );
  const decipher = createDecipheriv(
    "aes-256-gcm",
    dataKey,
    Buffer.from(envelope.iv, "base64"),
    { authTagLength: 16 }
  );
  decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
