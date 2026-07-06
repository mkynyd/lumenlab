import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activeStorageProvider,
  createSignedDownloadUrl,
  deleteStoredObject,
  readStoredObject,
  uploadFileBuffer,
  uploadObjectBuffer,
} from "@/lib/storage/object-storage";

const ENV_KEYS = [
  "NODE_ENV",
  "QINIU_ACCESS_KEY",
  "QINIU_SECRET_KEY",
  "QINIU_BUCKET",
  "QINIU_REGION",
  "QINIU_UPLOAD_HOST",
  "QINIU_PRIVATE_DOMAIN",
] as const;

function setEnv(key: string, value: string | undefined) {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) delete env[key];
  else env[key] = value;
}

describe("object storage adapter", () => {
  const originalEnv = new Map<string, string | undefined>();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-19T00:00:00.000Z"));
    for (const key of ENV_KEYS) {
      originalEnv.set(key, process.env[key]);
      setEnv(key, undefined);
    }
    setEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv.get(key);
      setEnv(key, value);
    }
    vi.useRealTimers();
  });

  it("falls back to local storage outside production when Qiniu is not configured", async () => {
    expect(activeStorageProvider()).toBe("local");

    const stored = await uploadFileBuffer({
      userId: "user-1",
      projectId: "project-1",
      fileId: "file-1",
      originalName: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("hello"),
    });

    expect(stored.provider).toBe("local");
    await expect(readStoredObject(stored)).resolves.toEqual(Buffer.from("hello"));
    await expect(deleteStoredObject(stored)).resolves.toBeUndefined();
  });

  it("requires Qiniu config in production", () => {
    setEnv("NODE_ENV", "production");

    expect(() => activeStorageProvider()).toThrow("生产环境缺少七牛对象存储配置");
  });

  it("stores nested server-generated object keys locally", async () => {
    const stored = await uploadObjectBuffer({
      key: "users/user-1/conversions/conversion-1/assets/asset-1/circuit.png",
      mimeType: "image/png",
      buffer: Buffer.from([1, 2, 3]),
    });

    expect(stored).toEqual({
      provider: "local",
      key: "users/user-1/conversions/conversion-1/assets/asset-1/circuit.png",
    });
    await expect(readStoredObject(stored)).resolves.toEqual(
      Buffer.from([1, 2, 3])
    );
    await expect(deleteStoredObject(stored)).resolves.toBeUndefined();
  });

  it("rejects object keys that escape the upload root", async () => {
    await expect(
      uploadObjectBuffer({
        key: "../escape.png",
        mimeType: "image/png",
        buffer: Buffer.from([1]),
      })
    ).rejects.toThrow("对象路径无效");
  });

  it("creates a short-lived private Qiniu download URL", () => {
    setEnv("QINIU_ACCESS_KEY", "ak");
    setEnv("QINIU_SECRET_KEY", "sk");
    setEnv("QINIU_BUCKET", "course-ai-lab");
    setEnv("QINIU_REGION", "z2");
    setEnv("QINIU_UPLOAD_HOST", "https://up-z2.qiniup.com");
    setEnv("QINIU_PRIVATE_DOMAIN", "coursecdn.mkynstudio.top");

    const url = createSignedDownloadUrl({
      provider: "qiniu",
      key: "users/user-1/projects/project-1/files/file-1/notes.txt",
      filename: "课堂笔记.txt",
      expiresInSeconds: 600,
    });

    expect(url).toContain(
      "https://coursecdn.mkynstudio.top/users/user-1/projects/project-1/files/file-1/notes.txt"
    );
    expect(url).toContain("attname=%E8%AF%BE%E5%A0%82%E7%AC%94%E8%AE%B0.txt");
    expect(url).toContain("e=1781827800");
    expect(url).toContain("token=ak:");
  });

  it("creates a private Qiniu URL for a multimedia style", () => {
    setEnv("QINIU_ACCESS_KEY", "ak");
    setEnv("QINIU_SECRET_KEY", "sk");
    setEnv("QINIU_BUCKET", "course-ai-lab");
    setEnv("QINIU_PRIVATE_DOMAIN", "coursecdn.mkynstudio.top");

    const url = createSignedDownloadUrl({
      provider: "qiniu",
      key: "users/user-1/profile/avatar/source.png",
      styleName: "avatar.jpg",
      expiresInSeconds: 600,
    });

    expect(url).toContain(
      "https://coursecdn.mkynstudio.top/users/user-1/profile/avatar/source.png-avatar.jpg"
    );
    expect(url).toContain("e=1781827800");
    expect(url).toContain("token=ak:");
  });
});
