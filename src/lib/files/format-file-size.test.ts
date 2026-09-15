import { describe, expect, it } from "vitest";

import { formatFileSize } from "./format-file-size";

describe("formatFileSize", () => {
  it("空值返回空串", () => {
    expect(formatFileSize(null)).toBe("");
    expect(formatFileSize(undefined)).toBe("");
    expect(formatFileSize(Number.NaN)).toBe("");
    expect(formatFileSize(-1)).toBe("");
  });

  it("0 与不足 1KB 按字节显示", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1023)).toBe("1023 B");
  });

  it("1KB 边界向上取 KB", () => {
    expect(formatFileSize(1024)).toBe("1.0 KB");
  });

  it("非整数值保留一位小数", () => {
    expect(formatFileSize(1536)).toBe("1.5 KB");
  });

  it("大文件晋级 MB 且大数值取整", () => {
    expect(formatFileSize(50 * 1024 * 1024)).toBe("50.0 MB");
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe("1.5 MB");
  });

  it("超过 TB 不再晋级", () => {
    expect(formatFileSize(3 * 1024 ** 4)).toBe("3.0 TB");
  });
});
