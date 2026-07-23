"use client";

import { useRef, useState } from "react";
import { useSession } from "next-auth/react";
import Cropper, { type Area } from "react-easy-crop";
import "react-easy-crop/react-easy-crop.css";
import { ArrowLeft, Camera, X, ZoomIn, ZoomOut } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { AvatarMark } from "@/components/user/avatar-mark";
import {
  useUpdateUserProfile,
  useUploadUserAvatar,
  useUserProfile,
  type UserProfile
} from "@/lib/hooks/use-user-profile";
import { avatarPresetById } from "@/lib/user-profile";
import { createCroppedAvatarFile } from "@/lib/avatar-crop";

const MAX_AVATAR_UPLOAD_BYTES = 20 * 1024 * 1024;
const AVATAR_ACCEPT = "image/png,image/jpeg,image/webp";
const AVATAR_TYPES = new Set(AVATAR_ACCEPT.split(","));
const PROFILE_FIELD_CLASS =
  "h-9 rounded-lg border border-[var(--color-border-light)] bg-[var(--color-surface)] transition-colors duration-150 focus:border-[var(--color-accent)] motion-reduce:transition-none";

type ProfileDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ProfileDialog({ open, onOpenChange }: ProfileDialogProps) {
  const { data: session, update: updateSession } = useSession();
  const profileQuery = useUserProfile();
  const updateProfile = useUpdateUserProfile();
  const uploadAvatar = useUploadUserAvatar();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const croppedAreaRef = useRef<Area | null>(null);
  // Bumped whenever local state resets, so async continuations from a
  // previous "session" (e.g. after the dialog closed) skip state writes.
  const sessionRef = useRef(0);

  const profile = profileQuery.data;
  const currentName = profile?.name || session?.user?.name || "";
  const currentAvatarPreset = avatarPresetById(
    profile?.avatarPreset || session?.user?.avatarPreset
  ).id;
  const currentAvatarUrl = profile?.avatarUrl || session?.user?.image || null;
  const email = profile?.email || session?.user?.email || "";

  const [view, setView] = useState<"main" | "crop">("main");
  const [name, setName] = useState<string | null>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [isCropping, setIsCropping] = useState(false);
  const [avatarUploaded, setAvatarUploaded] = useState(false);

  const nameValue = name ?? currentName;
  const nameDirty = name !== null && name.trim() !== currentName.trim();

  function resetLocalState() {
    sessionRef.current += 1;
    setView("main");
    setName(null);
    setImageSrc(null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setAvatarError(null);
    setSaveError(false);
    setIsCropping(false);
    setAvatarUploaded(false);
    croppedAreaRef.current = null;
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetLocalState();
    onOpenChange(next);
  }

  function applyProfileToSession(nextProfile: UserProfile) {
    return updateSession({
      user: {
        name: nextProfile.name,
        avatarPreset: nextProfile.avatarPreset,
        image: nextProfile.avatarUrl
      }
    });
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Allow picking the same file again later.
    event.target.value = "";
    if (!file) return;
    if (!AVATAR_TYPES.has(file.type)) {
      setAvatarError("仅支持 JPG、PNG 或 WebP 头像");
      return;
    }
    if (file.size > MAX_AVATAR_UPLOAD_BYTES) {
      setAvatarError("头像不能超过 20MB");
      return;
    }
    setAvatarError(null);
    const sessionSnapshot = sessionRef.current;
    const reader = new FileReader();
    reader.onload = () => {
      if (sessionSnapshot !== sessionRef.current) return;
      setImageSrc(reader.result as string);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setView("crop");
    };
    reader.onerror = () => {
      if (sessionSnapshot !== sessionRef.current) return;
      setAvatarError("图片读取失败，请重试");
    };
    reader.readAsDataURL(file);
  }

  function handleCropCancel() {
    setView("main");
    setImageSrc(null);
  }

  async function handleCropConfirm() {
    if (!imageSrc || !croppedAreaRef.current) return;
    const sessionSnapshot = sessionRef.current;
    setIsCropping(true);
    try {
      const file = await createCroppedAvatarFile(
        imageSrc,
        croppedAreaRef.current
      );
      if (sessionSnapshot !== sessionRef.current) return;
      setView("main");
      setImageSrc(null);
      const nextProfile = await uploadAvatar.mutateAsync(file);
      if (sessionSnapshot !== sessionRef.current) return;
      await applyProfileToSession(nextProfile);
      setAvatarUploaded(true);
    } catch (error) {
      if (sessionSnapshot !== sessionRef.current) return;
      setView("main");
      setImageSrc(null);
      setAvatarError(
        error instanceof Error ? error.message : "上传失败，请重试"
      );
    } finally {
      if (sessionSnapshot === sessionRef.current) setIsCropping(false);
    }
  }

  async function handleSaveName() {
    setSaveError(false);
    const sessionSnapshot = sessionRef.current;
    try {
      const nextProfile = await updateProfile.mutateAsync({
        name: nameValue.trim()
      });
      if (sessionSnapshot !== sessionRef.current) return;
      await applyProfileToSession(nextProfile);
      handleOpenChange(false);
    } catch {
      if (sessionSnapshot !== sessionRef.current) return;
      setSaveError(true);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="inset-0 flex h-dvh max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-[var(--color-surface)] p-0 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-none [&>[data-slot=dialog-close]]:right-[max(0.5rem,env(safe-area-inset-right))] [&>[data-slot=dialog-close]]:top-[max(0.5rem,env(safe-area-inset-top))] sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-1/2 sm:h-auto sm:max-h-[min(640px,calc(100vh-3rem))] sm:max-w-[540px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:border-[var(--color-border-light)] sm:pb-0 sm:pt-0 sm:[&>[data-slot=dialog-close]]:right-2 sm:[&>[data-slot=dialog-close]]:top-2"
      >
        {view === "main" ? (
          <>
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--color-border-light)] px-5">
              <DialogTitle className="text-base font-semibold">
                编辑个人资料
              </DialogTitle>
              <DialogDescription className="sr-only">
                修改昵称和头像
              </DialogDescription>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => handleOpenChange(false)}
                aria-label="关闭个人资料"
              >
                <X size={16} strokeWidth={1.8} />
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5">
              <div className="divide-y divide-[var(--color-border-light)]">
                <div className="grid gap-3 py-5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center">
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text-primary)]">
                      头像
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-tertiary)]">
                      JPG、PNG 或 WebP，最大 20MB
                    </p>
                  </div>
                  <div className="flex flex-col items-start sm:items-end">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="group relative block rounded-full outline-none transition-transform duration-150 active:scale-[0.98] active:duration-75 focus-visible:ring-2 focus-visible:ring-[var(--color-accent-muted)] motion-reduce:transition-none"
                      aria-label="更换头像"
                    >
                      <AvatarMark
                        presetId={currentAvatarPreset}
                        src={currentAvatarUrl}
                        alt={`${nameValue.trim() || email || "账户"} 的头像`}
                        className="size-16 rounded-full text-xl"
                      />
                      <span className="absolute -bottom-0.5 -right-0.5 flex size-7 items-center justify-center rounded-full border border-[var(--color-border-light)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] transition-colors duration-150 group-hover:text-[var(--color-text-primary)] motion-reduce:transition-none">
                        <Camera size={14} strokeWidth={1.8} />
                      </span>
                      {uploadAvatar.isPending && (
                        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40">
                          <Spinner className="size-5 text-white" />
                        </span>
                      )}
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={AVATAR_ACCEPT}
                      onChange={handleFileChange}
                      className="hidden"
                    />
                    {avatarError && (
                      <p
                        role="alert"
                        className="mt-2 text-xs text-[var(--color-error)]"
                      >
                        {avatarError}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid gap-2 py-5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center">
                  <label
                    htmlFor="profile-name"
                    className="text-sm font-medium text-[var(--color-text-primary)]"
                  >
                    昵称
                  </label>
                  <Input
                    id="profile-name"
                    value={nameValue}
                    onChange={(event) => {
                      setName(event.target.value);
                      setSaveError(false);
                    }}
                    placeholder="你的称呼"
                    maxLength={60}
                    className={PROFILE_FIELD_CLASS}
                  />
                </div>

                <div className="grid gap-1 py-5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center">
                  <span className="text-sm font-medium text-[var(--color-text-primary)]">
                    邮箱
                  </span>
                  <span
                    className="truncate text-sm text-[var(--color-text-secondary)] sm:text-right"
                    title={email}
                  >
                    {email}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-auto flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--color-border-light)] px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:pb-4">
              {saveError && (
                <span
                  className="mr-auto text-xs text-[var(--color-error)]"
                  role="alert"
                >
                  保存失败，请重试
                </span>
              )}
              <Button
                variant="secondary"
                size="md"
                onClick={() => handleOpenChange(false)}
                className="rounded-lg px-4"
              >
                取消
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={
                  nameDirty ? handleSaveName : () => handleOpenChange(false)
                }
                disabled={
                  (!nameDirty && !avatarUploaded) ||
                  updateProfile.isPending ||
                  profileQuery.isPending ||
                  uploadAvatar.isPending
                }
                className="rounded-lg px-4"
              >
                {updateProfile.isPending
                  ? "保存中..."
                  : nameDirty || !avatarUploaded
                    ? "保存"
                    : "完成"}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex h-14 shrink-0 items-center gap-2 border-b border-[var(--color-border-light)] px-3">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleCropCancel}
                aria-label="返回"
              >
                <ArrowLeft size={16} strokeWidth={1.8} />
              </Button>
              <DialogTitle className="text-base font-semibold">
                裁切头像
              </DialogTitle>
              <DialogDescription className="sr-only">
                拖动调整头像裁切区域
              </DialogDescription>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => handleOpenChange(false)}
                aria-label="关闭头像裁切"
                className="ml-auto"
              >
                <X size={16} strokeWidth={1.8} />
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="relative h-[min(18rem,48vh)] w-full overflow-hidden rounded-xl bg-black">
                {imageSrc && (
                  <Cropper
                    image={imageSrc}
                    crop={crop}
                    zoom={zoom}
                    aspect={1}
                    cropShape="round"
                    showGrid={false}
                    onCropChange={setCrop}
                    onZoomChange={setZoom}
                    onCropComplete={(_, pixels) => {
                      croppedAreaRef.current = pixels;
                    }}
                  />
                )}
              </div>

              <div className="mt-5 flex items-center gap-3">
                <ZoomOut
                  size={14}
                  strokeWidth={1.8}
                  className="shrink-0 text-[var(--color-text-tertiary)]"
                />
                <Slider
                  value={[zoom]}
                  min={1}
                  max={3}
                  step={0.05}
                  onValueChange={(value) => setZoom(value[0] ?? 1)}
                  aria-label="缩放"
                />
                <ZoomIn
                  size={14}
                  strokeWidth={1.8}
                  className="shrink-0 text-[var(--color-text-tertiary)]"
                />
              </div>
            </div>

            <div className="mt-auto flex shrink-0 justify-end gap-2 border-t border-[var(--color-border-light)] px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:pb-4">
              <Button
                variant="secondary"
                size="md"
                onClick={handleCropCancel}
                className="rounded-lg px-4"
              >
                取消
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={handleCropConfirm}
                disabled={uploadAvatar.isPending || isCropping}
                className="rounded-lg px-4"
              >
                {uploadAvatar.isPending
                  ? "上传中..."
                  : isCropping
                    ? "处理中..."
                    : "确认"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
