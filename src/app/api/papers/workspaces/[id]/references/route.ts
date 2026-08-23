import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { createPaperReference, importPaperReferenceFromDoi, importPaperReferencesFromBibTeX, listPaperReferences } from "@/lib/paper/service";
import { researchErrorResponse } from "@/lib/research/http";

const manualSchema = z.object({ action: z.literal("manual"), title: z.string().trim().min(1).max(500), authors: z.array(z.string().trim().min(1)).max(64).optional(), year: z.number().int().positive().nullable().optional(), venue: z.string().trim().max(500).nullable().optional(), doi: z.string().trim().nullable().optional(), arxivId: z.string().trim().nullable().optional(), url: z.string().url().nullable().optional() }).strict();
const doiSchema = z.object({ action: z.literal("doi"), doi: z.string().trim().min(3).max(200) }).strict();
const bibtexSchema = z.object({ action: z.literal("bibtex"), bibtex: z.string().trim().min(10).max(500_000) }).strict();
const requestSchema = z.discriminatedUnion("action", [manualSchema, doiSchema, bibtexSchema]);

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try {
    return NextResponse.json({ references: await listPaperReferences(session.user.id, (await context.params).id) });
  } catch (error) {
    return researchErrorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  const paperWorkspaceId = (await context.params).id;
  try {
    if (parsed.data.action === "doi") return NextResponse.json({ references: [await importPaperReferenceFromDoi({ userId: session.user.id, paperWorkspaceId, doi: parsed.data.doi })] }, { status: 201 });
    if (parsed.data.action === "bibtex") return NextResponse.json({ references: await importPaperReferencesFromBibTeX({ userId: session.user.id, paperWorkspaceId, bibtex: parsed.data.bibtex }) }, { status: 201 });
    return NextResponse.json({ reference: await createPaperReference({ userId: session.user.id, paperWorkspaceId, ...parsed.data }) }, { status: 201 });
  } catch (error) {
    return researchErrorResponse(error);
  }
}
