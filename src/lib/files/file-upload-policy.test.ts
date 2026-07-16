import { describe, expect, it } from "vitest";
import {
  getMimeTypeForExtension,
  isAllowedExtension,
  validateUploadFile,
} from "./file-upload-policy";

describe("file upload policy", () => {
  it("admits common video formats for Qwen multimodal understanding", () => {
    expect(isAllowedExtension("lecture.mp4")).toBe(true);
    expect(isAllowedExtension("demo.webm")).toBe(true);
    expect(getMimeTypeForExtension("mov")).toBe("video/quicktime");
    expect(validateUploadFile({
      name: "lecture.mp4",
      size: 1024,
      type: "video/mp4",
    })).toBeNull();
  });
});
