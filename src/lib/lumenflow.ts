export const LUMENFLOW_MAX_NODES = 12;
export const LUMENFLOW_MAX_EDGES = 16;

export type LumenFlowTone = "default" | "primary";

export interface LumenFlowNode {
  id: string;
  label: string;
  tone: LumenFlowTone;
}

export interface LumenFlowDiagram {
  version: 1;
  title?: string;
  nodes: LumenFlowNode[];
  edges: Array<[string, string]>;
  returnFlow?: { label: string; text: string };
}

export type LumenFlowParseResult =
  | { ok: true; diagram: LumenFlowDiagram }
  | { ok: false; error: string };

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function parseLumenFlow(source: string): LumenFlowParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return { ok: false, error: "LumenFlow 必须是合法 JSON。" };
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "LumenFlow 根节点必须是对象。" };
  }

  const value = raw as Record<string, unknown>;
  const allowedKeys = new Set(["version", "title", "nodes", "edges", "returnFlow"]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    return { ok: false, error: "LumenFlow 不支持未定义字段。" };
  }
  if (value.version !== 1) {
    return { ok: false, error: "LumenFlow 仅支持 version: 1。" };
  }
  const title = value.title == null ? undefined : asTrimmedString(value.title);
  if (value.title != null && !title) {
    return { ok: false, error: "图表标题必须是非空文本。" };
  }

  if (!Array.isArray(value.nodes) || value.nodes.length === 0) {
    return { ok: false, error: "LumenFlow 至少需要一个节点。" };
  }
  if (value.nodes.length > LUMENFLOW_MAX_NODES) {
    return {
      ok: false,
      error: `单个 LumenFlow 最多 ${LUMENFLOW_MAX_NODES} 个节点，请拆分图表。`,
    };
  }

  const seenIds = new Set<string>();
  const nodes: LumenFlowNode[] = [];
  for (const rawNode of value.nodes) {
    if (!rawNode || typeof rawNode !== "object" || Array.isArray(rawNode)) {
      return { ok: false, error: "每个节点必须是对象。" };
    }
    const node = rawNode as Record<string, unknown>;
    const id = asTrimmedString(node.id);
    const label = asTrimmedString(node.label);
    if (!id || !/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(id)) {
      return { ok: false, error: "节点 id 只能使用字母、数字、连字符和下划线。" };
    }
    if (!label || label.length > 32) {
      return { ok: false, error: "节点文字不能为空，且最多 32 个字符。" };
    }
    if (seenIds.has(id)) {
      return { ok: false, error: `节点 id 重复：${id}。` };
    }
    seenIds.add(id);
    if (node.tone != null && node.tone !== "default" && node.tone !== "primary") {
      return { ok: false, error: "节点 tone 仅支持 default 或 primary。" };
    }
    const tone = node.tone === "primary" ? "primary" : "default";
    nodes.push({ id, label, tone });
  }

  if (!Array.isArray(value.edges)) {
    return { ok: false, error: "edges 必须是节点 id 对组成的数组。" };
  }
  if (value.edges.length > LUMENFLOW_MAX_EDGES) {
    return {
      ok: false,
      error: `单个 LumenFlow 最多 ${LUMENFLOW_MAX_EDGES} 条连线，请拆分图表。`,
    };
  }

  const edges: Array<[string, string]> = [];
  for (const rawEdge of value.edges) {
    if (!Array.isArray(rawEdge) || rawEdge.length !== 2) {
      return { ok: false, error: "每条连线必须是 [来源节点, 目标节点]。" };
    }
    const from = asTrimmedString(rawEdge[0]);
    const to = asTrimmedString(rawEdge[1]);
    if (!from || !to || !seenIds.has(from) || !seenIds.has(to)) {
      return { ok: false, error: "连线只能引用已声明的节点。" };
    }
    if (from === to) {
      return { ok: false, error: "连线的起点和终点不能相同。" };
    }
    edges.push([from, to]);
  }

  const expectedEdges = nodes.slice(1).map(
    (node, index) => [nodes[index].id, node.id] as [string, string]
  );
  if (
    edges.length !== expectedEdges.length ||
    edges.some(
      ([from, to], index) =>
        from !== expectedEdges[index][0] || to !== expectedEdges[index][1]
    )
  ) {
    return {
      ok: false,
      error: "当前 LumenFlow 仅支持按 nodes 顺序连接的单一路径。",
    };
  }

  let returnFlow: LumenFlowDiagram["returnFlow"];
  if (value.returnFlow != null) {
    if (
      !value.returnFlow ||
      typeof value.returnFlow !== "object" ||
      Array.isArray(value.returnFlow)
    ) {
      return { ok: false, error: "returnFlow 必须是对象。" };
    }
    const rawReturnFlow = value.returnFlow as Record<string, unknown>;
    const label = asTrimmedString(rawReturnFlow.label);
    const text = asTrimmedString(rawReturnFlow.text);
    if (!label || !text || label.length > 32 || text.length > 160) {
      return { ok: false, error: "returnFlow 需要长度受限的 label 和 text。" };
    }
    returnFlow = { label, text };
  }

  return { ok: true, diagram: { version: 1, title: title || undefined, nodes, edges, returnFlow } };
}

function nodeColors(tone: LumenFlowTone) {
  if (tone === "primary") return { fill: "#2563eb", text: "#ffffff" };
  return { fill: "#ffffff", text: "#1f2937" };
}

/** A deterministic export renderer for the compact LumenFlow grammar. */
export function renderLumenFlowSvg(diagram: LumenFlowDiagram): string {
  const nodeWidth = 164;
  const nodeHeight = 68;
  const gap = 58;
  const padding = 34;
  const titleHeight = diagram.title ? 42 : 0;
  const width = padding * 2 + diagram.nodes.length * nodeWidth + Math.max(0, diagram.nodes.length - 1) * gap;
  const height = nodeHeight + padding * 2 + titleHeight + (diagram.returnFlow ? 58 : 0);

  const nodePositions = new Map(
    diagram.nodes.map((node, index) => [
      node.id,
      { x: padding + index * (nodeWidth + gap), y: padding + titleHeight },
    ]),
  );

  const edgeMarkup = diagram.edges
    .map(([from, to]) => {
      const source = nodePositions.get(from)!;
      const target = nodePositions.get(to)!;
      const x1 = source.x + nodeWidth;
      const y1 = source.y + nodeHeight / 2;
      const x2 = target.x;
      const y2 = target.y + nodeHeight / 2;
      return `<path d="M ${x1} ${y1} L ${x2} ${y2}" fill="none" stroke="#2563eb" stroke-width="3" marker-end="url(#arrow)"/>`;
    })
    .join("");

  const nodeMarkup = diagram.nodes
    .map((node) => {
      const position = nodePositions.get(node.id)!;
      const colors = nodeColors(node.tone);
      return `<g><rect x="${position.x}" y="${position.y}" width="${nodeWidth}" height="${nodeHeight}" rx="16" fill="${colors.fill}" stroke="#dbe4f0"/><text x="${position.x + nodeWidth / 2}" y="${position.y + 41}" text-anchor="middle" fill="${colors.text}" font-family="Arial, 'Noto Sans SC', sans-serif" font-size="17" font-weight="600">${escapeXml(node.label)}</text></g>`;
    })
    .join("");

  const returnFlowMarkup = diagram.returnFlow
    ? `<path d="M ${width - padding - 8} ${height - 28} H ${padding + 8}" fill="none" stroke="#64748b" stroke-width="2.5" marker-end="url(#arrow)"/><text x="${padding}" y="${height - 37}" fill="#475569" font-family="Arial, 'Noto Sans SC', sans-serif" font-size="14" font-weight="600">${escapeXml(diagram.returnFlow.label)}</text><text x="${padding + 108}" y="${height - 37}" fill="#64748b" font-family="Arial, 'Noto Sans SC', sans-serif" font-size="13">${escapeXml(diagram.returnFlow.text)}</text>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(diagram.title || "流程图")}"><defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#2563eb"/></marker></defs>${diagram.title ? `<text x="${padding}" y="28" fill="#111827" font-family="Arial, 'Noto Sans SC', sans-serif" font-size="19" font-weight="700">${escapeXml(diagram.title)}</text>` : ""}${edgeMarkup}${nodeMarkup}${returnFlowMarkup}</svg>`;
}
