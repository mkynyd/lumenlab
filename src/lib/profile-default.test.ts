import { describe, expect, it, vi } from "vitest";
import { findDefaultCredentialProfile } from "@/lib/profile-default";

describe("findDefaultCredentialProfile", () => {
  it("selects the first active profile with an active deepseek credential", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "profile-1" });

    const result = await findDefaultCredentialProfile({
      credentialProfile: { findFirst },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        status: "active",
        credentials: {
          some: { provider: "deepseek", status: "active" },
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    expect(result).toEqual({ id: "profile-1" });
  });

  it("returns null when no profile qualifies", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);

    const result = await findDefaultCredentialProfile({
      credentialProfile: { findFirst },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect(result).toBeNull();
  });
});
