import { describe, expect, it } from "vitest";
import { registerSchema } from "@/lib/validators";

describe("registerSchema", () => {
  it("requires a registration code", () => {
    expect(
      registerSchema.parse({
        email: "alpha@example.com",
        password: "password123",
        registrationCode: "ALPHA-7X9P",
      })
    ).toEqual({
      email: "alpha@example.com",
      password: "password123",
      registrationCode: "ALPHA-7X9P",
    });

    expect(() =>
      registerSchema.parse({
        email: "alpha@example.com",
        password: "password123",
      })
    ).toThrow();
  });
});
