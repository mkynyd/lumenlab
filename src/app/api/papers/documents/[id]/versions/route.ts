import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { researchErrorResponse } from "@/lib/research/http";
import { listDocumentVersions, restoreDocumentVersion } from "@/lib/paper/service";

const restoreSchema = z.object({ version: z.number().int().positive() }).strict();

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try {
    return NextResponse.json({ versions: await listDocumentVersions(session.user.id, (await context.params).id) });
  } catch (error) {
    return researchErrorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const parsed = restoreSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  try {
    return NextResponse.json({ version: await restoreDocumentVersion({ userId: session.user.id, documentId: (await context.params).id, version: parsed.data.version }) }, { status: 201 });
  } catch (error) {
    return researchErrorResponse(error);
  }
}
