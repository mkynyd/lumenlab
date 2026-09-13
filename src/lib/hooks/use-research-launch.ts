"use client";

import { useCallback, useRef, useState } from "react";
import { fetchJson } from "@/lib/api/client";
import type { FileAttachment } from "@/lib/chat/router";

export type ResearchBudgetProfile = "quick" | "deep" | "comprehensive";

export interface ResearchLaunchInput {
  question: string;
  attachments: FileAttachment[];
  budgetProfile: ResearchBudgetProfile;
  commanderModel: string;
  domainProfileKey?: string;
}

export type ResearchAttachmentStatus = "uploading" | "done" | "failed";

export interface ResearchAttachmentState {
  id: string;
  name: string;
  status: ResearchAttachmentStatus;
  error?: string;
}

export type ResearchLaunchPhase =
  | "idle"
  | "uploading"
  | "awaiting_attachment_decision"
  | "creating"
  | "done"
  | "error";

export interface ResearchLaunchResult {
  workspaceId: string;
  runId: string;
}

function truncateWithEllipsis(text: string, max: number): string {
  const compact = text.trim().replace(/\s+/g, " ");
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

interface UploadFileResult {
  files?: Array<{ id?: string }>;
  errors?: Array<{ name?: string; error?: string }>;
  summary?: { total: number; succeeded: number; failed: number };
}

/**
 * 逐个附件上传到项目文件库（含解析 + RAG 索引）。返回失败数量；
 * 每个附件的状态通过 onStatus 回调逐文件上报。
 */
export async function uploadResearchAttachments(
  projectId: string,
  attachments: FileAttachment[],
  onStatus: (id: string, status: ResearchAttachmentStatus, error?: string) => void,
): Promise<number> {
  let failed = 0;
  for (const attachment of attachments) {
    onStatus(attachment.id, "uploading");
    try {
      const formData = new FormData();
      formData.append("files", attachment.data, attachment.name);
      formData.append("category", "通用");
      await fetchJson<UploadFileResult>(`/api/projects/${projectId}/files`, {
        method: "POST",
        body: formData,
      });
      onStatus(attachment.id, "done");
    } catch (caught) {
      failed += 1;
      onStatus(attachment.id, "failed", caught instanceof Error ? caught.message : "上传失败");
    }
  }
  return failed;
}

async function createResearchAttachmentProject(question: string): Promise<{ id: string }> {
  const response = await fetchJson<{ project: { id: string } }>("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: `${truncateWithEllipsis(question, 30)} · 研究资料`, type: "general" }),
  });
  return response.project;
}

/**
 * 「一次提问 = 建 workspace + 首个 run」的客户端编排：
 * 附件 → 建项目 → 逐文件上传 → 建 workspace → 建 run。
 * 附件全部失败时暂停在 awaiting_attachment_decision，由调用方决定降级或重试。
 */
export function useResearchLaunch() {
  const [phase, setPhase] = useState<ResearchLaunchPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [attachmentStates, setAttachmentStates] = useState<ResearchAttachmentState[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const pendingDecisionRef = useRef<ResearchLaunchInput | null>(null);
  const lastInputRef = useRef<ResearchLaunchInput | null>(null);

  const launch = useCallback(async (input: ResearchLaunchInput): Promise<ResearchLaunchResult | null> => {
    const question = input.question.trim();
    if (question.length < 3) return null;
    lastInputRef.current = input;
    pendingDecisionRef.current = null;
    setError(null);
    setNotice(null);
    let projectId: string | null = null;
    try {
      if (input.attachments.length > 0) {
        setPhase("uploading");
        setAttachmentStates(input.attachments.map((attachment) => ({ id: attachment.id, name: attachment.name, status: "uploading" as const })));
        const project = await createResearchAttachmentProject(question);
        projectId = project.id;
        const failedCount = await uploadResearchAttachments(projectId, input.attachments, (id, status, fileError) => {
          setAttachmentStates((current) => current.map((item) => (item.id === id ? { ...item, status, error: fileError } : item)));
        });
        if (failedCount === input.attachments.length) {
          pendingDecisionRef.current = input;
          setPhase("awaiting_attachment_decision");
          return null;
        }
        if (failedCount > 0) {
          setNotice(`${failedCount} 个附件上传失败，已使用其余 ${input.attachments.length - failedCount} 个附件继续。`);
        }
      }

      setPhase("creating");
      const workspace = (
        await fetchJson<{ workspace: { id: string } }>("/api/research/workspaces", {
          method: "POST",
          body: JSON.stringify({
            name: truncateWithEllipsis(question, 40),
            domainProfileKey: input.domainProfileKey,
            budgetProfile: input.budgetProfile,
            ...(projectId ? { projectId } : {}),
          }),
        })
      ).workspace;
      const run = (
        await fetchJson<{ run: { id: string } }>(`/api/research/workspaces/${workspace.id}/runs`, {
          method: "POST",
          body: JSON.stringify({ question, budgetProfile: input.budgetProfile, commanderModel: input.commanderModel }),
        })
      ).run;
      setPhase("done");
      return { workspaceId: workspace.id, runId: run.id };
    } catch (caught) {
      setPhase("error");
      setError(caught instanceof Error ? caught.message : "研究创建失败，请重试");
      return null;
    }
  }, []);

  const continueWithoutFiles = useCallback(async (): Promise<ResearchLaunchResult | null> => {
    const pending = pendingDecisionRef.current;
    if (!pending) return null;
    return launch({ ...pending, attachments: [] });
  }, [launch]);

  const retry = useCallback(async (): Promise<ResearchLaunchResult | null> => {
    const input = pendingDecisionRef.current ?? lastInputRef.current;
    if (!input) return null;
    return launch(input);
  }, [launch]);

  return {
    launch,
    continueWithoutFiles,
    retry,
    phase,
    error,
    notice,
    attachmentStates,
    busy: phase === "uploading" || phase === "creating",
  };
}
