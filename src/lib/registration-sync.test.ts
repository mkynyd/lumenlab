import { describe, expect, it } from "vitest";
import {
  isSyncTimestampFresh,
  registrationSnapshotSchema,
} from "@/lib/registration-sync";

describe("isSyncTimestampFresh", () => {
  const now = new Date("2026-06-15T12:00:00.000Z").getTime();

  it("accepts timestamps inside the five minute window", () => {
    expect(isSyncTimestampFresh(String(now - 299_000), now)).toBe(true);
  });

  it("rejects expired, future, and malformed timestamps", () => {
    expect(isSyncTimestampFresh(String(now - 301_000), now)).toBe(false);
    expect(isSyncTimestampFresh(String(now + 301_000), now)).toBe(false);
    expect(isSyncTimestampFresh("not-a-number", now)).toBe(false);
  });
});

describe("registrationSnapshotSchema", () => {
  const valid = {
    publicationId: "pub_01",
    version: 1,
    issuedAt: "2026-06-15T12:00:00.000Z",
    credentialProfiles: [
      {
        id: "profile_01",
        name: "Alpha Group A",
        status: "active",
        version: 1,
        credentials: [
          {
            id: "credential_01",
            provider: "deepseek",
            key: "sk-secret",
            keyPrefix: "sk-********cret",
            status: "active",
            validatedAt: "2026-06-15T11:00:00.000Z",
          },
        ],
      },
    ],
    registrationCodes: [
      {
        id: "code_01",
        credentialProfileId: "profile_01",
        label: "First testers",
        code: "ALPHA-7X9P-K2M4",
        codeHint: "ALPHA-****-K2M4",
        status: "active",
        maxRedemptions: 5,
        expiresAt: null,
        revokeRedeemedUsers: false,
      },
    ],
  };

  it("accepts a complete publication snapshot", () => {
    expect(registrationSnapshotSchema.parse(valid)).toEqual(valid);
  });

  it("rejects zero redemption limits and profiles without DeepSeek", () => {
    expect(() =>
      registrationSnapshotSchema.parse({
        ...valid,
        registrationCodes: [
          { ...valid.registrationCodes[0], maxRedemptions: 0 },
        ],
      })
    ).toThrow();

    expect(() =>
      registrationSnapshotSchema.parse({
        ...valid,
        credentialProfiles: [
          {
            ...valid.credentialProfiles[0],
            credentials: [
              {
                ...valid.credentialProfiles[0].credentials[0],
                provider: "minimax",
              },
            ],
          },
        ],
      })
    ).toThrow();
  });

  it("preserves an explicit redeemed-user revocation instruction", () => {
    const parsed = registrationSnapshotSchema.parse({
      ...valid,
      registrationCodes: [
        { ...valid.registrationCodes[0], revokeRedeemedUsers: true },
      ],
    });

    expect(parsed.registrationCodes[0].revokeRedeemedUsers).toBe(true);
  });
});
