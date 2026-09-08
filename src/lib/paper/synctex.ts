import { basename } from "node:path";

export interface SyncTexPosition {
  page: number;
  tag: number;
  line: number;
  sourceFile: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SyncTexNodeLocation extends SyncTexPosition {
  nodeId: string;
  kind: string;
}

const SCALED_POINT = 65_536;

function sourceName(value: string | undefined) {
  if (!value) return null;
  return basename(value.replaceAll("\\", "/"));
}

/** Parse the stable line-oriented portion of a SyncTeX file. */
export function parseSyncTexText(text: string): SyncTexPosition[] {
  const inputs = new Map<number, string>();
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^Input:(\d+):(.+)$/);
    if (match) inputs.set(Number(match[1]), sourceName(match[2]) ?? "");
  }

  const positions: SyncTexPosition[] = [];
  let page = 0;
  for (const line of lines) {
    const pageMatch = line.match(/^!(\d+)/);
    if (pageMatch) {
      page = Number(pageMatch[1]);
      continue;
    }
    const record = line.match(/^[\[\]()kgxyvh](-?\d+),(-?\d+):(-?\d+),(-?\d+)(?:,(-?\d+),(-?\d+),(-?\d+))?/);
    if (!record || page < 1) continue;
    positions.push({
      page,
      tag: Number(record[1]),
      line: Number(record[2]),
      sourceFile: inputs.get(Number(record[1])) ?? null,
      x: Number(record[3]) / SCALED_POINT,
      y: Number(record[4]) / SCALED_POINT,
      width: Number(record[5] ?? 0) / SCALED_POINT,
      height: Number(record[6] ?? 0) / SCALED_POINT,
    });
  }
  return positions;
}

function closestPosition(positions: SyncTexPosition[], line: number) {
  return positions
    .map((position) => ({ position, distance: Math.abs(position.line - line) }))
    .sort((left, right) => left.distance - right.distance || left.position.line - right.position.line)[0]?.position;
}

export function mapSyncTexToNodes(input: { text: string; nodeMap: Record<string, { line: number; kind: string }> }) {
  const positions = parseSyncTexText(input.text);
  const generatedContentPositions = positions.filter((position) => position.sourceFile === "generated-content.tex");
  const candidates = generatedContentPositions.length > 0 ? generatedContentPositions : positions;
  const locations: SyncTexNodeLocation[] = [];
  for (const [nodeId, node] of Object.entries(input.nodeMap)) {
    const position = closestPosition(candidates, node.line);
    if (position) locations.push({ nodeId, kind: node.kind, ...position });
  }
  return { pageCount: positions.reduce((maximum, position) => Math.max(maximum, position.page), 0), locations };
}
