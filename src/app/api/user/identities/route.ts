import { NextResponse } from "next/server";
import { identitySettingsUser } from "@/lib/auth/identity-settings";
import { authIdentityRepository } from "@/lib/auth/service";
import { maskIdentifier } from "@/lib/auth/identifier";

export async function GET() {
  const user = await identitySettingsUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const identities = await authIdentityRepository.findIdentitiesByUserId(user.id);
  return NextResponse.json({ identities: identities.filter((row) => row.provider === "local" && ["email", "phone"].includes(row.type)).map((row) => ({ type: row.type, maskedValue: maskIdentifier(row.providerAccountId), verified: row.verifiedAt !== null })) });
}
