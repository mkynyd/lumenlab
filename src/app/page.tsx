import { auth } from "@/lib/auth";
import { learningFeatureFlags } from "@/lib/learning/feature-flags";
import { redirect } from "next/navigation";

export default async function Home() {
  const session = await auth();
  if (session?.user) {
    redirect(learningFeatureFlags.todayIsDefault ? "/today" : "/chat");
  }
  redirect("/home");
}
