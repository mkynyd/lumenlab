import crypto from "crypto";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import qiniu from "qiniu";

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

function createQiniuClients() {
  const config = qiniuConfig();
  if (!config) {
    throw new Error("缺少七牛对象存储配置");
  }
  const mac = new qiniu.auth.digest.Mac(config.accessKey, config.secretKey);
  const sdkConfig = new qiniu.conf.Config({
    useHttpsDomain: true,
    zone: qiniuZone(config.region, config.uploadHost),
  });
  return {
    config,
    mac,
    formUploader: new qiniu.form_up.FormUploader(sdkConfig),
    bucketManager: new qiniu.rs.BucketManager(mac, sdkConfig),
  };
}

function hostWithoutScheme(value: string) {
  return value.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

function qiniuZone(region: string, uploadHost: string) {
  const normalizedRegion = region.trim().toLowerCase();
  if (normalizedRegion === "z2") {
    return new qiniu.conf.Zone(
      [hostWithoutScheme(uploadHost)],
      [hostWithoutScheme(uploadHost)],
      "iovip-z2.qiniuio.com",
      "rs-z2.qiniuapi.com",
      "rsf-z2.qiniuapi.com",
      "api.qiniuapi.com"
    );
  }
  const zones: Record<string, qiniu.conf.Zone> = {
    z0: qiniu.zone.Zone_z0,
    "cn-east-2": qiniu.zone.Zone_cn_east_2,
    z1: qiniu.zone.Zone_z1,
    na0: qiniu.zone.Zone_na0,
    as0: qiniu.zone.Zone_as0,
  };
  return zones[normalizedRegion] || qiniu.zone.Zone_z2;
}

export async function uploadFileBuffer(input: UploadFileBufferInput): Promise<StoredUpload> {
  const { filename, key } = buildObjectKey(input);
  const provider = activeStorageProvider();

  if (provider === "local") {
    await mkdir(UPLOAD_DIR, { recursive: true });
    await writeFile(resolveLocalPath(filename), input.buffer);
    return { provider, key: filename, filename };
  }

  const { config, mac, formUploader } = createQiniuClients();
  const putPolicy = new qiniu.rs.PutPolicy({
    scope: `${config.bucket}:${key}`,
    insertOnly: 1,
    expires: 600,
  });
  const uploadToken = putPolicy.uploadToken(mac);
  const putExtra = new qiniu.form_up.PutExtra(
    input.originalName,
    {},
    input.mimeType
  );
  const result = await formUploader.put(uploadToken, key, input.buffer, putExtra);
  const statusCode = result.resp.statusCode ?? 0;
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`七牛上传失败：${statusCode}`);
  }

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

  const { config, mac, formUploader } = createQiniuClients();
  const putPolicy = new qiniu.rs.PutPolicy({
    scope: `${config.bucket}:${key}`,
    insertOnly: 1,
    expires: 600,
  });
  const uploadToken = putPolicy.uploadToken(mac);
  const putExtra = new qiniu.form_up.PutExtra(
    path.posix.basename(key),
    {},
    input.mimeType
  );
  const result = await formUploader.put(uploadToken, key, input.buffer, putExtra);
  const statusCode = result.resp.statusCode ?? 0;
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`七牛上传失败：${statusCode}`);
  }

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

export async function deleteStoredObject(input: StoredObjectRef): Promise<void> {
  if (!input.key) return;
  if (input.provider === "local") {
    await unlink(resolveLocalPath(input.key)).catch(() => {});
    return;
  }

  const { config, bucketManager } = createQiniuClients();
  const result = await bucketManager.delete(config.bucket, input.key);
  const statusCode = result.resp.statusCode ?? 0;
  if (statusCode === 612) return;
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`七牛删除失败：${statusCode}`);
  }
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
  const { config, bucketManager } = createQiniuClients();
  const deadline =
    Math.floor(Date.now() / 1000) +
    (input.expiresInSeconds ?? DEFAULT_SIGNED_URL_TTL_SECONDS);
  const query = input.filename
    ? `?attname=${encodeURIComponent(input.filename)}`
    : "";
  const objectKey = input.styleName
    ? `${input.key}-${input.styleName}`
    : input.key;
  return bucketManager.privateDownloadUrl(
    config.privateDomain,
    `${objectKey}${query}`,
    deadline
  );
}
