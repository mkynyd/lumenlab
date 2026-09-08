import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { createDocumentPatch } from "@/lib/paper/service";
import { documentPatchSchema } from "@/lib/paper/document-patches";
import { researchErrorResponse } from "@/lib/research/http";

const patchSchema = z.object({ patch: documentPatchSchema }).strict();

// Compatibility-only editing endpoint; scheduled for removal in task 11.

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  try {
    return NextResponse.json({ patch: await createDocumentPatch({ userId: session.user.id, documentId: (await context.params).id, patch: parsed.data.patch }) }, { status: 201 });
  } catch (error) {
    return researchErrorResponse(error);
  }
}
