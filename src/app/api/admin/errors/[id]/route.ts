import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/db";

const patchSchema = z.object({
  status: z.enum(["open", "resolved", "ignored"]),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { id } = await params;
  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "无效的状态" }, { status: 400 });
  }

  const item = await prisma.errorEvent.update({
    where: { id },
    data: { status: parsed.data.status },
  });
  return NextResponse.json({ item });
}
