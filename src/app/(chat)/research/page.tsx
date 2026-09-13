import { Suspense } from "react";
import { ResearchDashboard } from "@/components/research/research-dashboard";

export default function ResearchPage() {
  return (
    <Suspense>
      <ResearchDashboard />
    </Suspense>
  );
}
