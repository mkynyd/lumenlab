import {
  avatarPresetById,
  type AvatarPresetId,
} from "@/lib/user-profile";
import { cn } from "@/lib/utils";

const AVATAR_STYLE_CLASSES: Record<AvatarPresetId, string> = {
  lumen: "bg-[var(--color-accent)] text-[var(--color-accent-contrast)]",
  study: "bg-[var(--color-success-muted)] text-[var(--color-success)]",
  code: "bg-[var(--color-warning-muted)] text-[var(--color-warning)]",
  research: "bg-[var(--color-info-muted)] text-[var(--color-info)]",
};

export function AvatarMark({
  presetId,
  src,
  alt = "用户头像",
  className,
}: {
  presetId: AvatarPresetId | string | null | undefined;
  src?: string | null;
  alt?: string;
  className?: string;
}) {
  const preset = avatarPresetById(presetId);

  if (src) {
    return (
      <span
        className={cn(
          "flex shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-surface)]",
          className
        )}
      >
        {/* Authenticated avatar URLs cannot go through the Next image optimizer. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className="h-full w-full object-cover" />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-[var(--radius-md)] text-xs font-semibold",
        AVATAR_STYLE_CLASSES[preset.id],
        className
      )}
      aria-hidden="true"
    >
      {preset.label}
    </span>
  );
}
