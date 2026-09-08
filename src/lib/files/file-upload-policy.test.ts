import { describe, expect, it } from "vitest";
import {
  getMimeTypeForExtension,
  isAllowedExtension,
  validateImageFileBytes,
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

  it("validates PNG, JPEG, and WebP bytes against the filename", () => {
    expect(
      validateImageFileBytes(
        "diagram.png",
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      )
    ).toEqual({ ok: true, mimeType: "image/png" });
    expect(
      validateImageFileBytes("photo.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xe0]))
    ).toEqual({ ok: true, mimeType: "image/jpeg" });
    expect(
      validateImageFileBytes("image.webp", Buffer.from("RIFF0000WEBP", "ascii"))
    ).toEqual({ ok: true, mimeType: "image/webp" });
    expect(
      validateImageFileBytes("fake.png", Buffer.from([0xff, 0xd8, 0xff]))
    ).toMatchObject({ ok: false });
    expect(validateImageFileBytes("empty.png", Buffer.alloc(0))).toMatchObject({
      ok: false,
    });
  });
});
