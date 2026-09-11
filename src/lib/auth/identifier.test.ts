import { describe, expect, it } from "vitest";
import { normalizeEmail, normalizePhone, parseLoginIdentifier, maskIdentifier } from "./identifier";

describe("local identifiers", () => {
  it.each(["13812345678", "+8613812345678", "  +8613812345678  "])("normalizes %s to canonical E.164", (value) => {
    expect(normalizePhone(value)).toBe("+8613812345678");
    expect(parseLoginIdentifier(value)).toEqual({ type: "phone", provider: "local", channel: "sms", providerAccountId: "+8613812345678" });
  });
  it.each(["", "12345678901", "12812345678", "1381234567", "138123456789", "+12125551234", "8613812345678", "+86 13812345678", "138-1234-5678", "１３８１２３４５６７８", "a@", "x y@example.com"])("rejects %s", (value) => {
    expect(parseLoginIdentifier(value)).toBeNull();
  });
  it("preserves email normalization and masks only for presentation", () => {
    expect(normalizeEmail(" Foo@Example.COM ")).toBe("foo@example.com");
    expect(parseLoginIdentifier(" Foo@Example.COM ")).toMatchObject({ type: "email", providerAccountId: "foo@example.com" });
    expect(maskIdentifier("13812345678")).toBe("+86138****5678");
    expect(maskIdentifier("foo@example.com")).toBe("f***@example.com");
  });
});
