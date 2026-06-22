"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { X, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface UserRoleInfo {
  id: string;
  roleKey: string;
  label: string;
  isPrimary: boolean;
  description?: string;
}

export function AboutYouSection() {
  const [roles, setRoles] = useState<UserRoleInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [roleInput, setRoleInput] = useState("");
  const [isClassifying, setIsClassifying] = useState(false);
  const [availableRoles, setAvailableRoles] = useState<Array<{ key: string; label: string; description?: string }>>([]);

  // Load user's current roles
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/user/profile-roles");
        if (res.ok) {
          const data = await res.json();
          setRoles(data.roles || []);
          setAvailableRoles(data.availableRoles || []);
        }
      } catch {
        setError("加载角色失败");
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, []);

  // Toggle primary role
  const setPrimary = useCallback(async (roleId: string) => {
    try {
      const res = await fetch(`/api/user/profile-roles/${roleId}/primary`, {
        method: "POST",
      });
      if (res.ok) {
        setRoles((prev) =>
          prev.map((r) => ({ ...r, isPrimary: r.id === roleId }))
        );
      }
    } catch {
      // silent
    }
  }, []);

  // Remove role
  const removeRole = useCallback(async (roleId: string) => {
    try {
      const res = await fetch(`/api/user/profile-roles/${roleId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setRoles((prev) => prev.filter((r) => r.id !== roleId));
      }
    } catch {
      // silent
    }
  }, []);

  // Add role via classification
  const addRole = useCallback(async () => {
    if (!roleInput.trim()) return;
    setIsClassifying(true);
    try {
      const res = await fetch("/api/classification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userInput: roleInput.trim(), mode: "general" }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.classification?.roleKey) {
          // Save the profile role
          const saveRes = await fetch("/api/user/profile-roles", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ roleKey: data.classification.roleKey }),
          });
          if (saveRes.ok) {
            const saved = await saveRes.json();
            setRoles((prev) => [...prev, saved.role]);
            setRoleInput("");
            setShowAdd(false);
          }
        }
      }
    } catch {
      // silent
    } finally {
      setIsClassifying(false);
    }
  }, [roleInput]);

  if (isLoading) {
    return <Skeleton className="h-20 rounded-[var(--radius-md)]" />;
  }

  return (
    <div className="space-y-3">
      {/* Existing roles */}
      {roles.length > 0 && (
        <div className="space-y-2">
          {roles.map((role) => (
            <div
              key={role.id}
              className={cn(
                "flex items-center gap-3 rounded-[var(--radius-md)] p-3 text-sm",
                role.isPrimary
                  ? "bg-[var(--color-accent-muted)]"
                  : "bg-[var(--color-surface)]"
              )}
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium text-[var(--color-text-primary)] truncate">
                  {role.label}
                  {role.isPrimary && (
                    <span className="ml-1.5 text-[11px] text-[var(--color-accent)]">
                      · 主角色
                    </span>
                  )}
                </p>
                {role.description && (
                  <p className="text-xs text-[var(--color-text-secondary)] mt-0.5 truncate">
                    {role.description}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {!role.isPrimary && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPrimary(role.id)}
                    className="h-7 text-xs"
                  >
                    设为主角
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeRole(role.id)}
                  className="h-7 w-7 p-0"
                  aria-label={`移除角色 ${role.label}`}
                >
                  <X size={14} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add role */}
      {showAdd ? (
        <div className="rounded-[var(--radius-md)] bg-[var(--color-surface)] p-3 space-y-2">
          <label className="text-xs text-[var(--color-text-secondary)]">
            输入你的专业/职业描述
          </label>
          <Input
            value={roleInput}
            onChange={(e) => setRoleInput(e.target.value)}
            placeholder="例如：信息安全专业本科生 / 高中化学教师"
            maxLength={200}
            onKeyDown={(e) => {
              if (e.key === "Enter" && roleInput.trim()) addRole();
            }}
          />
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={!roleInput.trim() || isClassifying}
              onClick={addRole}
            >
              {isClassifying ? "分析中..." : "确认添加"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setShowAdd(false); setRoleInput(""); }}
            >
              取消
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowAdd(true)}
          className="text-[var(--color-text-secondary)]"
        >
          <Plus size={14} className="mr-1" />
          添加角色
        </Button>
      )}

      {error && (
        <p className="text-xs text-[var(--color-error)]">{error}</p>
      )}
    </div>
  );
}
