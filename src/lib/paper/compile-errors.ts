export interface CompileNodeLocation {
  line: number;
  generatedLine?: number;
  kind: string;
}

export interface CompileErrorNode {
  nodeId: string;
  line: number;
  kind: string;
  source: "main" | "generated";
}

function errorLine(output: string) {
  const generated = /generated-content\.tex:(\d+)/i.exec(output);
  if (generated) return { line: Number(generated[1]), source: "generated" as const };
  const main = /main\.tex:(\d+)/i.exec(output);
  if (main) return { line: Number(main[1]), source: "main" as const };
  const inputLine = /on input line (\d+)/i.exec(output);
  return inputLine ? { line: Number(inputLine[1]), source: "main" as const } : null;
}

export function mapCompileErrorToNode(input: { output?: string; nodeMap: Record<string, CompileNodeLocation> }): CompileErrorNode | null {
  if (!input.output) return null;
  const location = errorLine(input.output);
  if (!location) return null;
  const candidates = Object.entries(input.nodeMap)
    .map(([nodeId, node]) => ({ nodeId, node, line: location.source === "generated" ? node.generatedLine ?? node.line : node.line }))
    .filter((item) => Number.isInteger(item.line) && item.line > 0 && item.line <= location.line)
    .sort((left, right) => right.line - left.line);
  const match = candidates[0];
  return match ? { nodeId: match.nodeId, line: match.line, kind: match.node.kind, source: location.source } : null;
}
