import { Suspense } from "react";
import { FileLibraryView } from "@/components/files/file-library-view";

export default function FilesPage() {
  // FileLibraryView 读 useSearchParams 做筛选同步，需要 Suspense 边界。
  return (
    <Suspense fallback={null}>
      <FileLibraryView />
    </Suspense>
  );
}
