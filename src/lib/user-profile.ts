export const AVATAR_PRESETS = [
  { id: "lumen", label: "L", name: "Lumen" },
  { id: "study", label: "S", name: "Study" },
  { id: "code", label: "C", name: "Code" },
  { id: "research", label: "R", name: "Research" },
] as const;

export type AvatarPresetId = (typeof AVATAR_PRESETS)[number]["id"];

export const DEFAULT_AVATAR_PRESET: AvatarPresetId = "lumen";

export const AVATAR_PRESET_IDS = AVATAR_PRESETS.map((preset) => preset.id) as [
  AvatarPresetId,
  ...AvatarPresetId[],
];

export function avatarPresetById(id: string | null | undefined) {
  return (
    AVATAR_PRESETS.find((preset) => preset.id === id) ||
    AVATAR_PRESETS.find((preset) => preset.id === DEFAULT_AVATAR_PRESET)!
  );
}

export function buildUserAvatarUrl(user: {
  avatarObjectKey?: string | null;
  avatarUpdatedAt?: Date | string | null;
}) {
  if (!user.avatarObjectKey) return null;
  const updatedAt =
    user.avatarUpdatedAt instanceof Date
      ? user.avatarUpdatedAt.getTime()
      : user.avatarUpdatedAt
        ? new Date(user.avatarUpdatedAt).getTime()
        : 0;
  const version = Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : 0;
  return `/api/user/profile/avatar?v=${version}`;
}
