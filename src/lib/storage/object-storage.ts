import crypto from "crypto";
import { mkdir, open, readFile, stat, unlink, writeFile } from "fs/promises";
import path from "path";

export type StorageProvider = "local" | "qiniu";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const DEFAULT_SIGNED_URL_TTL_SECONDS = 600;

export interface StoredObjectRef {
  provider: StorageProvider;
  key: string;
}

export interface StoredUpload extends StoredObjectRef {
  filename: string;
}

interface UploadFileBufferInput {
  userId: string;
  projectId: string;
  fileId: string;
  originalName: string;
  mimeType: string;
  buffer: Buffer;
}

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function normalizeDomain(domain: string) {
  return /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
}

function qiniuConfig() {
  if (process.env.URLLIB_ENABLE_PROXY || process.env.URLLIB_PROXY) {
    throw new Error("七牛存储禁止启用 URLLIB 代理；请移除 URLLIB_ENABLE_PROXY/URLLIB_PROXY");
  }
  const accessKey = process.env.QINIU_ACCESS_KEY;
  const secretKey = process.env.QINIU_SECRET_KEY;
  const bucket = process.env.QINIU_BUCKET;
  const privateDomain = process.env.QINIU_PRIVATE_DOMAIN;
  const region = process.env.QINIU_REGION || "z2";
  const uploadHost = process.env.QINIU_UPLOAD_HOST || "https://up-z2.qiniup.com";
  if (!accessKey || !secretKey || !bucket || !privateDomain) {
    return null;
  }
  return {
    accessKey,
    secretKey,
    bucket,
    privateDomain: normalizeDomain(privateDomain),
    region,
    uploadHost,
    rsHost: process.env.QINIU_RS_HOST || "https://rs.qiniuapi.com",
  };
}

export function activeStorageProvider(): StorageProvider {
  if (qiniuConfig()) return "qiniu";
  if (isProduction()) {
    throw new Error("生产环境缺少七牛对象存储配置");
  }
  return "local";
}

function buildObjectKey(input: {
  userId: string;
  projectId: string;
  fileId: string;
  originalName: string;
}) {
  const ext = path.extname(input.originalName).toLowerCase();
  const filename = `${crypto.randomUUID()}${ext}`;
  return {
    filename,
    key: [
      "users",
      input.userId,
      "projects",
      input.projectId,
      "files",
      input.fileId,
      filename,
    ].join("/"),
  };
}

function resolveLocalPath(key: string) {
  const resolvedPath = path.resolve(UPLOAD_DIR, key);
  if (!resolvedPath.startsWith(`${path.resolve(UPLOAD_DIR)}${path.sep}`)) {
    throw new Error("文件路径无效");
  }
  return resolvedPath;
}

function normalizeObjectKey(key: string) {
  const normalized = key.trim().replace(/\\/g, "/");
  const segments = normalized.split("/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("对象路径无效");
  }
  return normalized;
}

function urlSafeBase64(value: string | Buffer) {
  return Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
}

function qiniuAccessToken(accessKey: string, secretKey: string, data: string) {
  const digest = crypto.createHmac("sha1", secretKey).update(data).digest();
  return `${accessKey}:${urlSafeBase64(digest)}`;
}

function qiniuUploadToken(config: NonNullable<ReturnType<typeof qiniuConfig>>, key: string) {
  const policy = urlSafeBase64(JSON.stringify({
    scope: `${config.bucket}:${key}`,
    insertOnly: 1,
    deadline: Math.floor(Date.now() / 1000) + 600,
  }));
  return `${qiniuAccessToken(config.accessKey, config.secretKey, policy)}:${policy}`;
}

async function uploadQiniuBuffer(input: {
  key: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
}) {
  const config = qiniuConfig();
  if (!config) throw new Error("缺少七牛对象存储配置");
  const form = new FormData();
  form.set("token", qiniuUploadToken(config, input.key));
  form.set("key", input.key);
  form.set(
    "file",
    new Blob([new Uint8Array(input.buffer)], { type: input.mimeType }),
    input.filename
  );
  const response = await fetch(config.uploadHost, { method: "POST", body: form });
  if (!response.ok) throw new Error(`七牛上传失败：${response.status}`);
}

export async function uploadFileBuffer(input: UploadFileBufferInput): Promise<StoredUpload> {
  const { filename, key } = buildObjectKey(input);
  const provider = activeStorageProvider();

  if (provider === "local") {
    await mkdir(UPLOAD_DIR, { recursive: true });
    await writeFile(resolveLocalPath(filename), input.buffer);
    return { provider, key: filename, filename };
  }

  await uploadQiniuBuffer({
    key,
    filename: input.originalName,
    mimeType: input.mimeType,
    buffer: input.buffer,
  });

  return { provider, key, filename };
}

export async function uploadObjectBuffer(input: {
  key: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<StoredObjectRef> {
  const key = normalizeObjectKey(input.key);
  const provider = activeStorageProvider();

  if (provider === "local") {
    const target = resolveLocalPath(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, input.buffer);
    return { provider, key };
  }

  await uploadQiniuBuffer({
    key,
    filename: path.posix.basename(key),
    mimeType: input.mimeType,
    buffer: input.buffer,
  });

  return { provider, key };
}

export async function readStoredObject(input: StoredObjectRef): Promise<Buffer> {
  if (input.provider === "local") {
    return readFile(resolveLocalPath(input.key));
  }

  const url = createSignedDownloadUrl({
    provider: input.provider,
    key: input.key,
    expiresInSeconds: DEFAULT_SIGNED_URL_TTL_SECONDS,
  });
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`七牛文件下载失败：${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export interface StoredObjectRange {
  data: Buffer;
  /** 对象总字节数，用于构造 Content-Range。 */
  totalSize: number;
  /** 实际返回的闭区间端点。 */
  start: number;
  end: number;
}

/**
 * 读取对象的一个字节区间。原件预览（尤其是 PDF）会连续发 Range 请求，
 * 每次都整块读入再切片既浪费带宽也浪费内存，所以本地文件走区间读、
 * 七牛走 Range 头透传；存储端不认 Range 时回退成读全量再切片，语义不变。
 */
export async function readStoredObjectRange(
  input: StoredObjectRef & { start: number; end: number | null }
): Promise<StoredObjectRange> {
  if (input.provider === "local") {
    const filePath = resolveLocalPath(input.key);
    const stats = await stat(filePath);
    const totalSize = stats.size;
    const start = Math.max(input.start, 0);
    if (start >= totalSize) {
      // 起点越界：返回空区间，由调用方决定是否回 416，不擅自截到最后一个字节。
      return { data: Buffer.alloc(0), totalSize, start, end: start };
    }
    const lastByte = totalSize - 1;
    const end =
      input.end === null ? lastByte : Math.min(Math.max(input.end, start), lastByte);
    const length = end - start + 1;
    const handle = await open(filePath, "r");
    try {
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, start);
      return { data: buffer, totalSize, start, end };
    } finally {
      await handle.close();
    }
  }

  const url = createSignedDownloadUrl({
    provider: input.provider,
    key: input.key,
    expiresInSeconds: DEFAULT_SIGNED_URL_TTL_SECONDS,
  });
  const response = await fetch(url, {
    headers: { Range: `bytes=${input.start}-${input.end ?? ""}` },
  });

  if (response.status !== 206) {
    if (!response.ok) {
      throw new Error(`七牛文件下载失败：${response.status}`);
    }
    const full = Buffer.from(await response.arrayBuffer());
    const lastByte = Math.max(full.length - 1, 0);
    const start = Math.min(input.start, lastByte);
    const end =
      input.end === null ? lastByte : Math.min(Math.max(input.end, start), lastByte);
    return {
      data: full.subarray(start, end + 1),
      totalSize: full.length,
      start,
      end,
    };
  }

  const parsed = response.headers
    .get("content-range")
    ?.match(/^bytes (\d+)-(\d+)\/(\d+|\*)$/);
  const start = parsed ? Number(parsed[1]) : input.start;
  const end = parsed ? Number(parsed[2]) : (input.end ?? input.start);
  // 总长度缺失（`*`）时用已读到的末尾兜底，至少让 Content-Range 自洽。
  const totalSize = parsed && parsed[3] !== "*" ? Number(parsed[3]) : end + 1;
  return {
    data: Buffer.from(await response.arrayBuffer()),
    totalSize,
    start,
    end,
  };
}

export async function deleteStoredObject(input: StoredObjectRef): Promise<void> {
  if (!input.key) return;
  if (input.provider === "local") {
    await unlink(resolveLocalPath(input.key)).catch(() => {});
    return;
  }

  const config = qiniuConfig();
  if (!config) throw new Error("缺少七牛对象存储配置");
  const entry = urlSafeBase64(`${config.bucket}:${input.key}`);
  const pathToSign = `/delete/${entry}`;
  const response = await fetch(new URL(pathToSign, config.rsHost), {
    method: "POST",
    headers: {
      Authorization: `QBox ${qiniuAccessToken(config.accessKey, config.secretKey, `${pathToSign}\n`)}`,
    },
  });
  if (response.status === 612) return;
  if (!response.ok) throw new Error(`七牛删除失败：${response.status}`);
}

export function createSignedDownloadUrl(input: {
  provider: StorageProvider;
  key: string;
  filename?: string;
  styleName?: string;
  expiresInSeconds?: number;
}) {
  if (input.provider !== "qiniu") {
    throw new Error("本地文件不支持签名下载链接");
  }
  const config = qiniuConfig();
  if (!config) throw new Error("缺少七牛对象存储配置");
  const deadline =
    Math.floor(Date.now() / 1000) +
    (input.expiresInSeconds ?? DEFAULT_SIGNED_URL_TTL_SECONDS);
  const query = input.filename
    ? `?attname=${encodeURIComponent(input.filename)}`
    : "";
  const objectKey = input.styleName
    ? `${input.key}-${input.styleName}`
    : input.key;
  const baseUrl = `${config.privateDomain}/${objectKey}${query}`;
  const urlToSign = `${baseUrl}${query ? "&" : "?"}e=${deadline}`;
  const token = qiniuAccessToken(config.accessKey, config.secretKey, urlToSign);
  return `${urlToSign}&token=${token}`;
}
