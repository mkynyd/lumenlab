/**
 * Mermaid 渲染兜底：当 Mermaid 生成的节点标签为空时，从原始 Mermaid 源码
 * 提取节点标签并回填到 SVG，避免节点只显示 ID（如 A/B/C）。
 *
 * 典型触发场景：模型输出 classDef / class / style 等样式语句时，
 * Mermaid v11 在某些配置下会生成空节点标签，但颜色样式仍生效。
 */

const NODE_SHAPE_PATTERNS = [
  { start: "[[", end: "]]" },       // 卡片
  { start: "(((", end: ")))" },     // 双圆
  { start: "((", end: "))" },       // 圆
  { start: "[(", end: ")]" },       // 圆柱
  { start: "[", end: "]" },         // 矩形
  { start: "{{", end: "}}" },       // 六边形
  { start: "{", end: "}" },         // 菱形
  { start: "(((", end: ")))" },
  { start: "((", end: "))" },
  { start: "(", end: ")" },         // 圆角矩形
  { start: ">", end: "]" },         // 旗形/非对称
];

function extractNodeLabelFromToken(token: string): string | null {
  for (const { start, end } of NODE_SHAPE_PATTERNS) {
    if (token.startsWith(start)) {
      const endIndex = token.indexOf(end, start.length);
      if (endIndex !== -1) {
        return token.slice(start.length, endIndex).trim();
      }
    }
  }
  return null;
}

function normalizeLabel(raw: string): string {
  // 去除 Mermaid 支持的 HTML 标签，如 <br/>、<br> 替换为空格
  return raw
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .trim();
}

export function extractMermaidNodeLabels(code: string): Map<string, string> {
  const labels = new Map<string, string>();
  const lines = code.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.replace(/%%.*$/, "").trim();
    if (!line) continue;

    // 跳过纯指令和样式行
    if (/^\s*(classDef|class|style|linkStyle|init|direction|end)\b/.test(line)) {
      continue;
    }

    // 提取 subgraph 标题，如 subgraph S1 [分组]
    const subgraphMatch = /^subgraph\s+([A-Za-z][A-Za-z0-9_]*)\s+(.+)$/.exec(line);
    if (subgraphMatch) {
      const id = subgraphMatch[1];
      const label = extractNodeLabelFromToken(subgraphMatch[2].trim());
      const normalized = label ? normalizeLabel(label) : "";
      if (normalized && normalized !== id) {
        labels.set(id, normalized);
      }
      continue;
    }

    // 移除边标签（如 -->|边文字|），避免干扰节点解析
    const lineWithoutEdgeLabels = line.replace(/\|[^|]+\|/g, " ");

    // 按常见箭头/连线拆分，处理一行多个节点定义的情况
    const parts = lineWithoutEdgeLabels.split(/-->|==>|--x|--o|-\.->|~>|--/);
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      const idMatch = /^([A-Za-z][A-Za-z0-9_]*)\b/.exec(trimmed);
      if (!idMatch) continue;

      const id = idMatch[1];
      const rest = trimmed.slice(id.length).trim();
      const label = extractNodeLabelFromToken(rest);
      const normalized = label ? normalizeLabel(label) : "";

      // 只保留有意义且不等于 ID 本身的标签
      if (normalized && normalized !== id) {
        labels.set(id, normalized);
      }
    }
  }

  return labels;
}

function parseNodeIdFromSvgId(nodeId: string): string | null {
  const match = /flowchart-([^-]+(?:-[^-]+)*)-\d+$/.exec(nodeId);
  return match?.[1] ?? null;
}

export function ensureNodeLabels(svgText: string, code: string): string {
  if (typeof document === "undefined" || !svgText) return svgText;

  const labels = extractMermaidNodeLabels(code);
  if (labels.size === 0) return svgText;

  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  const svg = doc.querySelector("svg");
  if (!svg) return svgText;

  let changed = false;
  svg.querySelectorAll(".node").forEach((node) => {
    const nodeId = parseNodeIdFromSvgId(node.id);
    if (!nodeId) return;

    const fallbackLabel = labels.get(nodeId) ?? nodeId;

    const labelGroup = node.querySelector(".label");
    if (!labelGroup) return;

    const textEls = labelGroup.querySelectorAll("text");
    if (textEls.length === 0) {
      // Mermaid 未生成 text 元素，主动创建一个居中的 text
      const text = doc.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("y", "-10.1");
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "middle");
      text.style.fill = "currentColor";
      const tspan = doc.createElementNS("http://www.w3.org/2000/svg", "tspan");
      tspan.setAttribute("class", "text-outer-tspan row");
      tspan.setAttribute("x", "0");
      tspan.setAttribute("y", "-0.1em");
      tspan.setAttribute("dy", "1.1em");
      tspan.setAttribute("text-anchor", "middle");
      tspan.textContent = fallbackLabel;
      text.appendChild(tspan);
      labelGroup.appendChild(text);
      changed = true;
      return;
    }

    const allEmpty = Array.from(textEls).every((t) =>
      Array.from(t.querySelectorAll("tspan")).every(
        (s) => !s.textContent?.trim()
      )
    );
    if (!allEmpty) return;

    textEls.forEach((text, index) => {
      const tspan = text.querySelector("tspan");
      if (index === 0 && tspan) {
        tspan.textContent = fallbackLabel;
        changed = true;
      }
    });
  });

  if (!changed) return svgText;
  return new XMLSerializer().serializeToString(svg);
}
