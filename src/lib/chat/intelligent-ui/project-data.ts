import { z } from "zod";

const projectedFiles = z.array(z.strictObject({
  name: z.string().min(1).max(100),
  sizeKb: z.number().int().nonnegative().max(1e12),
  status: z.string().min(1).max(40),
})).max(24);
export type ProjectFilesProjection = z.infer<typeof projectedFiles>;

export function projectFilesForUI(summary: Record<string, unknown> | undefined): ProjectFilesProjection | undefined {
  const rows = summary?.files;
  if (!Array.isArray(rows)) return undefined;
  const projection = [];
  for (const row of rows.slice(0, 24)) {
    if (!row || typeof row !== "object") return undefined;
    const name = typeof row.name === "string" ? row.name.slice(0, 100) : null;
    projection.push({ name, sizeKb: row.sizeKb, status: row.status });
  }
  const parsed = projectedFiles.safeParse(projection);
  return parsed.success ? parsed.data : undefined;
}

const statuses = new Map([
  ["ready", "就绪"], ["parsed", "已解析"], ["done", "已完成"], ["parsing", "解析中"],
  ["pending", "等待中"], ["failed", "解析失败"],
]);
function statusLabel(status: string) {
  return statuses.get(status) ?? status;
}

// A model may reference this round's project list, but the host owns every display
// value and column. Unknown sources and source overrides invalidate the group.
export function bindProjectData(raw: unknown, files: ProjectFilesProjection | undefined): unknown {
  const read = (node: unknown, depth: number): unknown => {
    if (!node || typeof node !== "object" || depth > 6) return null;
    const candidate = node as Record<string, unknown>;
    let props = candidate.props;
    if (props && typeof props === "object" && "source" in props && props.source !== "demo") {
      if (props.source !== "project-files" || Object.keys(props).length !== 1 || !files) return null;
      if (candidate.type === "table") {
        props = { source: "project-files", label: "最近项目文件（最多 24 项）", columns: ["文件", "大小（KB）", "状态"],
          rows: files.map(({ name, sizeKb, status }) => [name, sizeKb, statusLabel(status)]) };
      } else if (candidate.type === "bar" && files.length) {
        const counts = new Map<string, number>();
        for (const file of files) {
          const label = statusLabel(file.status);
          counts.set(label, (counts.get(label) ?? 0) + 1);
        }
        props = { source: "project-files", label: "最近项目文件状态（最多 24 项）", unit: "个", labels: [...counts.keys()],
          series: [{ label: "文件数", values: [...counts.values()] }] };
      } else {
        return null;
      }
    }
    return {
      ...candidate, props,
      ...(Array.isArray(candidate.children) && candidate.children.length <= 24 &&
        { children: candidate.children.map((child) => read(child, depth + 1)) }),
    };
  };
  if (!raw || typeof raw !== "object" || !("nodes" in raw) || !Array.isArray(raw.nodes) || raw.nodes.length > 24) return null;
  return { ...raw, nodes: raw.nodes.map((node) => read(node, 1)) };
}
