"use client";

import { cn } from "@/lib/utils";

interface AmbientFieldProps {
  intensity?: "low" | "medium";
  className?: string;
}

export function AmbientField({
  intensity = "low",
  className,
}: AmbientFieldProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "workbench-ambient",
        "workbench-ambient-dots",
        intensity === "medium" && "workbench-ambient-medium",
        className
      )}
    />
  );
}
