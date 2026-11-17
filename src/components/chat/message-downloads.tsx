"use client";

import { useState } from "react";
import { Download, FileText, Loader2, Presentation, Table2 } from "lucide-react";
import { artifactDownloadFormats, type ArtifactDownload } from "@/lib/artifacts/download";

function DownloadRow({ file }: { file: ArtifactDownload }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const kind = artifactDownloadFormats[file.format];
  const Icon = file.format === "xlsx" ? Table2 : file.format === "pptx" ? Presentation : FileText;

  async function download() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(file.downloadUrl);
      if (!response.ok || !response.headers.get("content-type")?.startsWith(kind.mimeType.split(";")[0])) {
        setError(response.status === 401 ? "登录后可下载" : response.status === 404 ? "文件已删除" : "下载失败，请重试");
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = file.filename;
      try {
        document.body.appendChild(link);
        link.click();
      } finally {
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
    } catch {
      setError("下载失败，请检查网络后重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <li className="min-w-0">
      <div className="flex min-w-0 items-center gap-2.5 rounded-lg bg-[var(--color-interaction-hover)] py-1.5 pl-3 pr-1.5">
        <Icon className="size-[18px] shrink-0 text-[var(--color-accent)]" aria-hidden />
        <div className="min-w-0 flex-1 py-0.5">
          <p className="truncate text-sm font-medium text-[var(--color-text-primary)]" title={file.filename}>{file.filename}</p>
          <p className="text-xs text-[var(--color-text-secondary)]">{kind.label}</p>
        </div>
        <button
          type="button"
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-interaction-active)] focus-visible:bg-[var(--color-interaction-active)] focus-visible:underline focus-visible:outline-none disabled:opacity-60"
          onClick={() => void download()}
          aria-label={`下载 ${file.filename}`}
          disabled={pending}
        >
          {pending ? <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
          下载
        </button>
      </div>
      {error && <p role="status" className="pt-1.5 text-xs text-[var(--color-text-secondary)]">{error}</p>}
    </li>
  );
}

export function MessageDownloads({ files }: { files: ArtifactDownload[] }) {
  if (!files.length) return null;
  return (
    <section className="mt-4 w-full max-w-[27rem]" aria-label="生成的文件">
      <ul className="grid list-none gap-2">
        {files.map((file) => <DownloadRow key={file.downloadUrl} file={file} />)}
      </ul>
    </section>
  );
}
