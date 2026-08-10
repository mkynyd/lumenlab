import { describe, expect, it } from "vitest";
import { FILE_CATEGORIES } from "@/lib/file-categories";

describe("FILE_CATEGORIES", () => {
  it("includes dedicated policy/notice and general-purpose categories", () => {
    expect(FILE_CATEGORIES).toContain("政策通知");
    expect(FILE_CATEGORIES).toContain("通用");
  });
});
