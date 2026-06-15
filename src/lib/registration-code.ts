import { createHmac } from "node:crypto";

export type RegistrationCodeState = {
  status: string;
  redemptionCount: number;
  maxRedemptions: number;
  expiresAt: Date | null;
};

export type RegistrationCodeEvaluation =
  | { allowed: true }
  | { allowed: false; reason: "disabled" | "exhausted" | "expired" };

export function normalizeRegistrationCode(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]+/g, "");
}

export function digestRegistrationCode(value: string, pepper: string): string {
  if (!pepper) {
    throw new Error("REGISTRATION_CODE_PEPPER is required");
  }

  return createHmac("sha256", pepper)
    .update(normalizeRegistrationCode(value))
    .digest("hex");
}

export function evaluateRegistrationCode(
  code: RegistrationCodeState,
  now = new Date()
): RegistrationCodeEvaluation {
  if (code.status !== "active") {
    return { allowed: false, reason: "disabled" };
  }
  if (code.redemptionCount >= code.maxRedemptions) {
    return { allowed: false, reason: "exhausted" };
  }
  if (code.expiresAt && code.expiresAt.getTime() <= now.getTime()) {
    return { allowed: false, reason: "expired" };
  }
  return { allowed: true };
}
