import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const status = new URL(request.url).searchParams.get("status");
  const items = await prisma.errorEvent.findMany({
    where: status ? { status } : {},
    orderBy: { lastSeenAt: "desc" },
    take: 100,
  });

  return NextResponse.json({ items });
}
