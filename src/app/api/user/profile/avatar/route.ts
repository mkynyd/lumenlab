import crypto from "crypto";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  createSignedDownloadUrl,
  deleteStoredObject,
  readStoredObject,
  uploadObjectBuffer,
  type StorageProvider,
} from "@/lib/storage/object-storage";
import {
  DEFAULT_AVATAR_PRESET,
  buildUserAvatarUrl,
  type AvatarPresetId,
} from "@/lib/user-profile";

const MAX_AVATAR_BYTES = 20 * 1024 * 1024;
const QINIU_AVATAR_STYLE_NAME = "avatar.jpg";
const AVATAR_MIME_EXTENSIONS = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

type UploadedAvatarFile = {
  type: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

function isUploadedFile(value: unknown): value is UploadedAvatarFile {
  return (
    !!value &&
    typeof value === "object" &&
    "arrayBuffer" in value &&
    typeof value.arrayBuffer === "function" &&
    "type" in value &&
    typeof value.type === "string" &&
    "size" in value &&
    typeof value.size === "number"
  );
}

function profileResponse(user: {
  email: string;
  name: string | null;
  avatarPreset: string | null;
  avatarObjectKey?: string | null;
  avatarUpdatedAt?: Date | string | null;
}) {
  return {
    email: user.email,
    name: user.name,
    avatarPreset: (user.avatarPreset || DEFAULT_AVATAR_PRESET) as AvatarPresetId,
    avatarUrl: buildUserAvatarUrl(user),
  };
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      avatarStorageProvider: true,
      avatarObjectKey: true,
      avatarMimeType: true,
    },
  });
  if (!user?.avatarStorageProvider || !user.avatarObjectKey) {
    return NextResponse.json({ error: "头像不存在" }, { status: 404 });
  }

  if (user.avatarStorageProvider === "qiniu") {
    return NextResponse.redirect(
      createSignedDownloadUrl({
        provider: "qiniu",
        key: user.avatarObjectKey,
        styleName: QINIU_AVATAR_STYLE_NAME,
        expiresInSeconds: 600,
      })
    );
  }

  const buffer = await readStoredObject({
    provider: user.avatarStorageProvider as StorageProvider,
    key: user.avatarObjectKey,
  });

  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": user.avatarMimeType || "application/octet-stream",
      "cache-control": "private, max-age=300",
    },
  });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  const avatarEntry = formData?.get("avatar") ?? null;
  if (!isUploadedFile(avatarEntry)) {
    return NextResponse.json({ error: "请选择头像文件" }, { status: 400 });
  }
  const avatar = avatarEntry;

  const extension = AVATAR_MIME_EXTENSIONS.get(avatar.type);
  if (!extension) {
    return NextResponse.json(
      { error: "仅支持 JPG、PNG 或 WebP 头像" },
      { status: 400 }
    );
  }
  if (avatar.size > MAX_AVATAR_BYTES) {
    return NextResponse.json(
      { error: "头像不能超过 20MB" },
      { status: 413 }
    );
  }

  const previousUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      avatarStorageProvider: true,
      avatarObjectKey: true,
    },
  });
  if (!previousUser) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }

  const key = [
    "users",
    session.user.id,
    "profile",
    "avatar",
    `${crypto.randomUUID()}.${extension}`,
  ].join("/");
  const stored = await uploadObjectBuffer({
    key,
    mimeType: avatar.type,
    buffer: Buffer.from(await avatar.arrayBuffer()),
  });
  const avatarUpdatedAt = new Date();

  let nextUser: {
    email: string;
    name: string | null;
    avatarPreset: string | null;
    avatarObjectKey: string | null;
    avatarUpdatedAt: Date | null;
  };

  try {
    nextUser = await prisma.user.update({
      where: { id: session.user.id },
      data: {
        avatarStorageProvider: stored.provider,
        avatarObjectKey: stored.key,
        avatarMimeType: avatar.type,
        avatarUpdatedAt,
      },
      select: {
        email: true,
        name: true,
        avatarPreset: true,
        avatarObjectKey: true,
        avatarUpdatedAt: true,
      },
    });
  } catch (error) {
    await deleteStoredObject(stored).catch(() => {});
    throw error;
  }

  if (previousUser.avatarStorageProvider && previousUser.avatarObjectKey) {
    await deleteStoredObject({
      provider: previousUser.avatarStorageProvider as StorageProvider,
      key: previousUser.avatarObjectKey,
    }).catch((error) => {
      console.warn("delete previous avatar failed:", error);
    });
  }

  return NextResponse.json(profileResponse(nextUser));
}
