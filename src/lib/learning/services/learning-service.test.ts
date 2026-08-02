import { describe, expect, it } from "vitest";

import { computeContentFingerprint } from "@/lib/files/content-fingerprint";
import { resolveFileFingerprint } from "@/lib/learning/services/learning-service";

describe("resolveFileFingerprint", () => {
  it("uses the stored column value when present", () => {
    expect(
      resolveFileFingerprint({
        textContent: "正文",
        enhancedContent: null,
        enhancementStatus: "none",
        contentFingerprint: "sha256:stored-v1",
      })
    ).toBe("sha256:stored-v1");
  });

  it("computes a deterministic sha256:v1 fingerprint for legacy rows with a NULL column", () => {
    const content = "基尔霍夫电流定律：流入节点的电流等于流出节点的电流。";
    const legacy = {
      textContent: content,
      enhancedContent: null,
      enhancementStatus: "none",
      contentFingerprint: null,
    };
    const first = resolveFileFingerprint(legacy);
    const second = resolveFileFingerprint(legacy);
    expect(first).toBe(second);
    expect(first).toBe(computeContentFingerprint(content));
    expect(first).toMatch(/^sha256:v1:[0-9a-f]{64}$/);
  });

  it("computes over the enhanced content when the file is enhanced", () => {
    const legacy = {
      textContent: "原始正文",
      enhancedContent: "增强后的正文",
      enhancementStatus: "enhanced",
      contentFingerprint: null,
    };
    expect(resolveFileFingerprint(legacy)).toBe(
      computeContentFingerprint("增强后的正文")
    );
  });

  it("returns null when there is no readable content", () => {
    expect(
      resolveFileFingerprint({
        textContent: null,
        enhancedContent: null,
        enhancementStatus: "none",
        contentFingerprint: null,
      })
    ).toBeNull();
    expect(
      resolveFileFingerprint({
        textContent: "   ",
        enhancedContent: null,
        enhancementStatus: "none",
        contentFingerprint: null,
      })
    ).toBeNull();
  });

  it("normalizes content identically to parse-job fingerprint writes", () => {
    const legacy = {
      textContent: "  第一行\r\n第二行  \n第三行  ",
      enhancedContent: null,
      enhancementStatus: "none",
      contentFingerprint: null,
    };
    // computeContentFingerprint 应用 NFC / CRLF / 行尾空白 / trim 归一化，
    // 现算值必须与其一致，才能与锚点里保存的值稳定匹配。
    expect(resolveFileFingerprint(legacy)).toBe(
      computeContentFingerprint("第一行\n第二行\n第三行")
    );
  });

  it("treats an empty stored fingerprint as missing and recomputes", () => {
    const legacy = {
      textContent: "正文内容",
      enhancedContent: null,
      enhancementStatus: "none",
      contentFingerprint: "",
    };
    expect(resolveFileFingerprint(legacy)).toBe(
      computeContentFingerprint("正文内容")
    );
  });
});
