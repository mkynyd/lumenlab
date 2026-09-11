import { NextResponse } from "next/server";
import { z } from "zod";
import { identitySettingsUser } from "@/lib/auth/identity-settings";
import { bindIdentityWithTicket } from "@/lib/auth/bind-identity";
import { registrationRepository } from "@/lib/data/registration-repository";
import { handleRegistrationError } from "@/app/api/auth/register/route";

const schema = z.object({ identifier: z.string().max(254), ticket: z.string().min(1).max(200) });
export async function POST(request: Request) {
  const user = await identitySettingsUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  try {
    await bindIdentityWithTicket({ ...parsed.data, userId: user.id }, { repository: registrationRepository });
    return NextResponse.json({ success: true });
  } catch (error) { return handleRegistrationError(error); }
}
