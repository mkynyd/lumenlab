import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { LandingSurface } from "@/components/landing/landing-surface";

export default async function Home() {
  const session = await auth();
  if (session?.user) {
    redirect("/chat");
  }
  return <LandingSurface />;
}
