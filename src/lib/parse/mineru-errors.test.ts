// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  getMinerUErrorMessage,
  MINERU_ERROR_MESSAGES,
  MINERU_GENERIC_ERROR_MESSAGE,
} from "@/lib/parse/mineru-errors";

describe("getMinerUErrorMessage", () => {
  it("returns mapped Chinese message for known MinerU err_code", () => {
    expect(getMinerUErrorMessage("-60009")).toBe("队列已满，请稍后重试");
    expect(getMinerUErrorMessage("-60005")).toBe(
      "文件大小超过 200MB 限制，请压缩或拆分后重试"
    );
    expect(getMinerUErrorMessage("A0202")).toContain("Token");
  });

  it("returns generic Chinese message for empty code without echoing the English err_msg", () => {
    const message = getMinerUErrorMessage(
      undefined,
      "failed to convert the file"
    );
    expect(message).toBe(MINERU_GENERIC_ERROR_MESSAGE);
    expect(message).not.toContain("failed");
  });

  it("returns generic Chinese message for empty-string code", () => {
    expect(getMinerUErrorMessage("", "some english error")).toBe(
      MINERU_GENERIC_ERROR_MESSAGE
    );
  });

  it("returns generic Chinese message for unknown code instead of the original message", () => {
    const message = getMinerUErrorMessage("-69999", "unknown internal error");
    expect(message).toBe(MINERU_GENERIC_ERROR_MESSAGE);
    expect(message).not.toContain("unknown internal error");
  });

  it("uses fallback only when code is absent and fallback is a non-empty string", () => {
    expect(getMinerUErrorMessage(undefined, "数据库写入失败，请重试")).toBe(
      "数据库写入失败，请重试"
    );
    expect(getMinerUErrorMessage(undefined, "   ")).toBe(
      MINERU_GENERIC_ERROR_MESSAGE
    );
    expect(getMinerUErrorMessage(undefined)).toBe(MINERU_GENERIC_ERROR_MESSAGE);
  });

  it("maps internal parse-flow codes to Chinese messages", () => {
    expect(getMinerUErrorMessage("timeout")).toContain("超时");
    expect(getMinerUErrorMessage("missing-zip-url")).not.toBe(
      MINERU_GENERIC_ERROR_MESSAGE
    );
  });

  it("maps non-stream request validation codes to Chinese messages", () => {
    expect(getMinerUErrorMessage("invalid-file")).toBe(
      "请选择有效的 PDF 文件"
    );
    expect(getMinerUErrorMessage("file-too-large")).toContain("200MB");
    expect(getMinerUErrorMessage("need-token")).toContain("MinerU Token");
  });

  it("mapping table only contains Chinese user-facing messages", () => {
    for (const message of Object.values(MINERU_ERROR_MESSAGES)) {
      expect(message).toMatch(/[一-龥]/);
    }
  });
});
