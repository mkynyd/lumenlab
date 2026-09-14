import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getManagedSkillsUpdater } from "@/lib/skills/managed-service";
import type { ManagedSkillInstallation } from "@/lib/skills/managed-updater";

function isOperator(email: string | null | undefined): boolean {
  if (!email) return false;
  const allowed = new Set((process.env.SKILL_UPDATE_ADMIN_EMAILS ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
  return allowed.has(email.trim().toLowerCase());
}

function sanitizedSourceUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "invalid-source";
  }
}

function publicInstallation(installation: ManagedSkillInstallation) {
  return {
    skillId: installation.skillId,
    category: installation.category,
    source: {
      type: installation.source.type,
      url: sanitizedSourceUrl(installation.source.url),
      path: installation.source.path,
      channel: installation.source.channel,
    },
    version: installation.version,
    installedRevision: installation.installedRevision,
    contentHash: installation.contentHash,
    policyHash: installation.policyHash,
    installedAt: installation.installedAt,
    lastCheckedAt: installation.lastCheckedAt,
    lastUpdatedAt: installation.lastUpdatedAt,
    autoUpdate: installation.autoUpdate,
    state: installation.state,
    previous: installation.previous ? { version: installation.previous.version, revision: installation.previous.revision, contentHash: installation.previous.contentHash } : null,
    candidate: installation.candidate ? { version: installation.candidate.version, revision: installation.candidate.revision, contentHash: installation.candidate.contentHash, policyHash: installation.candidate.policyHash } : null,
    reviewReasons: installation.reviewReasons ?? [],
    reviewSummary: installation.reviewSummary ?? [],
    lastError: installation.lastError ?? null,
    nextCheckAt: installation.nextCheckAt ?? null,
  };
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const updater = getManagedSkillsUpdater();
  if (!updater) return NextResponse.json({ enabled: false, installations: [], operator: false });
  return NextResponse.json({
    enabled: true,
    operator: isOperator(session.user.email),
    installations: updater.status().installations.map(publicInstallation),
  });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isOperator(session.user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const updater = getManagedSkillsUpdater();
  if (!updater) return NextResponse.json({ error: "Managed Skills is not configured" }, { status: 503 });
  const body = await request.json().catch(() => null) as { action?: string; skillId?: string } | null;
  if (!body || !["check", "update", "approve", "rollback"].includes(body.action ?? "")) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
  if ((body.action === "update" || body.action === "approve" || body.action === "rollback") && !body.skillId) {
    return NextResponse.json({ error: "skillId is required" }, { status: 400 });
  }
  const result = body.action === "rollback"
    ? await updater.rollback(body.skillId!)
    : body.action === "approve"
      ? await updater.promoteStaged(body.skillId!, true)
      : await updater.check(body.skillId, body.action === "update");
  return NextResponse.json({ result });
}
