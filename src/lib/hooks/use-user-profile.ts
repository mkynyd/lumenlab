"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import type { AvatarPresetId } from "@/lib/user-profile";

export interface UserProfile {
  email: string;
  name: string | null;
  avatarPreset: AvatarPresetId;
  avatarUrl: string | null;
}

export interface UpdateUserProfileInput {
  name: string;
  avatarPreset?: AvatarPresetId;
}

export function useUserProfile() {
  return useQuery({
    queryKey: queryKeys.userProfile,
    queryFn: () => fetchJson<UserProfile>("/api/user/profile"),
  });
}

export function useUpdateUserProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateUserProfileInput) =>
      fetchJson<UserProfile>("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: (profile) => {
      queryClient.setQueryData(queryKeys.userProfile, profile);
    },
  });
}

export function useUploadUserAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append("avatar", file);
      return fetchJson<UserProfile>("/api/user/profile/avatar", {
        method: "POST",
        body: formData,
      });
    },
    onSuccess: (profile) => {
      queryClient.setQueryData(queryKeys.userProfile, profile);
    },
  });
}
