"use client";

import { useParams, useRouter } from "next/navigation";
import { ArtifactLibrary } from "@/components/artifact/artifact-library";

export default function ProjectArtifactsPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  return (
    <div className="flex-1">
      <ArtifactLibrary
        projectId={projectId}
        refreshKey={0}
        onClose={() => router.push(`/projects/${projectId}`)}
      />
    </div>
  );
}
