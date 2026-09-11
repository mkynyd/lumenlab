/** The single normalization boundary for local login aliases. Client-safe. */
import { z } from "zod";

export type IdentityType = "email" | "phone";
export type LoginIdentifier = {
  type: IdentityType;
  provider: "local";
  providerAccountId: string;
  channel: "email" | "sms";
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isEmailIdentifier(value: string): boolean {
  return z.email().safeParse(value).success;
}

export function isNormalizableEmail(email: string): boolean {
  return isEmailIdentifier(normalizeEmail(email));
}

/** Mainland mobile only: accept 11 digits or +86, store canonical E.164. */
export function normalizePhone(value: string): string | null {
  const phone = value.trim();
  const national = phone.startsWith("+86") ? phone.slice(3) : phone;
  return /^1[3-9]\d{9}$/.test(national) ? `+86${national}` : null;
}

export function parseLoginIdentifier(value: unknown): LoginIdentifier | null {
  if (typeof value !== "string" || value.length > 254) return null;
  const email = normalizeEmail(value);
  if (isEmailIdentifier(email)) {
    return { type: "email", provider: "local", providerAccountId: email, channel: "email" };
  }
  const phone = normalizePhone(value);
  return phone ? { type: "phone", provider: "local", providerAccountId: phone, channel: "sms" } : null;
}

export function maskIdentifier(value: string): string {
  const identifier = parseLoginIdentifier(value);
  if (!identifier) return "未绑定";
  if (identifier.type === "phone") return `${identifier.providerAccountId.slice(0, 6)}****${identifier.providerAccountId.slice(-4)}`;
  const [local, domain] = identifier.providerAccountId.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}
