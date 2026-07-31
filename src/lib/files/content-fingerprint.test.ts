import { describe, expect, it } from "vitest";
import {
  computeContentFingerprint,
  getEffectiveFileContent,
  normalizeFingerprintContent,
} from "./content-fingerprint";

describe("file content fingerprint", () => {
  it("uses enhanced content only while that enhancement is current", () => {
    const file = {
      textContent: "OCR 原文",
      enhancedContent: "增强正文",
    };

    expect(
      getEffectiveFileContent({ ...file, enhancementStatus: "enhanced" })
    ).toBe("增强正文");
    expect(
      getEffectiveFileContent({ ...file, enhancementStatus: "stale" })
    ).toBe("OCR 原文");
    expect(
      getEffectiveFileContent({ ...file, enhancementStatus: "none" })
    ).toBe("OCR 原文");
  });

  it("falls back to OCR text when enhanced content is blank", () => {
    expect(
      getEffectiveFileContent({
        textContent: "OCR 原文",
        enhancedContent: " \n ",
        enhancementStatus: "enhanced",
      })
    ).toBe("OCR 原文");
  });

  it("normalizes equivalent line endings and trailing whitespace", () => {
    expect(normalizeFingerprintContent("第一行  \r\n第二行\r\n")).toBe(
      "第一行\n第二行"
    );
    expect(computeContentFingerprint("第一行  \r\n第二行\r\n")).toBe(
      computeContentFingerprint("第一行\n第二行")
    );
  });

  it("returns a versioned SHA-256 value and changes with effective content", () => {
    const first = computeContentFingerprint("内容一");
    const second = computeContentFingerprint("内容二");

    expect(first).toMatch(/^sha256:v1:[a-f0-9]{64}$/);
    expect(second).toMatch(/^sha256:v1:[a-f0-9]{64}$/);
    expect(first).not.toBe(second);
  });
});
