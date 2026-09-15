import { describe, expect, it } from "vitest";
import {
  File,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
} from "lucide-react";

import { attachmentIconFor } from "./attachment-icon";

describe("attachmentIconFor", () => {
  it("pdf 映射到 FileText", () => {
    expect(attachmentIconFor("report.pdf", "application/pdf")).toBe(FileText);
  });

  it("xlsx 映射到 FileSpreadsheet", () => {
    expect(attachmentIconFor("data.XLSX", "application/vnd.ms-excel")).toBe(
      FileSpreadsheet
    );
  });

  it("py 映射到 FileCode2", () => {
    expect(attachmentIconFor("script.py", "text/x-python")).toBe(FileCode2);
  });

  it("mp4 视频映射到 FileVideo（文件卡片用 kind 判断时用 FileVideo）", () => {
    expect(attachmentIconFor("clip.mp4", "video/mp4")).toBe(FileVideo);
  });

  it("MIME 优先于扩展名", () => {
    expect(attachmentIconFor("photo.png", "image/png")).toBe(FileImage);
  });

  it("未知类型回退到 File", () => {
    expect(attachmentIconFor("archive.xyz", "application/octet-stream")).toBe(
      File
    );
    expect(attachmentIconFor("no-extension", "application/octet-stream")).toBe(
      File
    );
  });
});
