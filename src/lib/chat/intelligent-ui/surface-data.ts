import type { Expression, StateValue, UINode, Variable } from "./catalog";

export const UI_SCHEMA_VERSION = 1;
export const UI_CATALOG_VERSION = 1;
export const MAX_SNAPSHOT_BYTES = 32 * 1024;
export const MAX_GROUP_BYTES = 14 * 1024;
export const MAX_GROUPS = 8;

export function acceptsValue(variable: Variable, value: unknown): value is StateValue {
  switch (variable.kind) {
    case "number": return typeof value === "number" && value >= variable.min && value <= variable.max;
    case "boolean": return typeof value === "boolean";
    case "choice": return variable.options.some((option) => option.value === value);
    case "list": return value === variable.initial;
  }
}

export interface UIGroup {
  id: string;
  state?: Variable[];
  nodes: UINode[];
}

export interface UISurface {
  schemaVersion: typeof UI_SCHEMA_VERSION;
  catalogVersion: typeof UI_CATALOG_VERSION;
  surfaceId: string;
  groups: UIGroup[];
}

export function makeSurface(surfaceId: string, groups: UIGroup[]): UISurface {
  return { schemaVersion: UI_SCHEMA_VERSION, catalogVersion: UI_CATALOG_VERSION, surfaceId, groups };
}

const encoder = new TextEncoder();

// Bound arbitrary input before any recursive schema or expression traversal.
export function withinBudget(root: unknown, maxBytes: number): boolean {
  const pending: Array<[unknown, number]> = [[root, 0]];
  let items = 0;
  let stringBytes = 0;
  for (let entry = pending.pop(); entry; entry = pending.pop()) {
    const [value, depth] = entry;
    if (++items > 5_000 || depth > 28 || pending.length > 5_000) return false;
    if (typeof value === "string") {
      stringBytes += encoder.encode(value).length;
      if (stringBytes > maxBytes) return false;
    } else if (Array.isArray(value)) {
      if (value.length > 64) return false;
      for (const child of value) pending.push([child, depth + 1]);
    } else if (value && typeof value === "object") {
      if (Object.getPrototypeOf(value) !== Object.prototype) return false;
      const entries = Object.entries(value);
      if (entries.length > 24) return false;
      for (const [key, child] of entries) {
        stringBytes += key.length;
        pending.push([child, depth + 1]);
      }
    }
  }
  return encoder.encode(JSON.stringify(root) ?? "").length <= maxBytes;
}

export function expressionRefs(value: Expression | undefined, names = new Set<string>()): Set<string> {
  if (value === undefined || typeof value !== "object" || Array.isArray(value)) return names;
  if ("ref" in value) names.add(value.ref);
  else for (const child of value.args) expressionRefs(child, names);
  return names;
}

export function nodeRefs(node: UINode): Set<string> {
  const names = expressionRefs(node.when);
  const add = (value: Expression | undefined) => expressionRefs(value, names);
  switch (node.type) {
    case "input": case "slider": case "select": case "checkbox": case "sequence":
      names.add(node.props.bind);
      break;
    case "text": add(node.props.text); break;
    case "value": add(node.props.value); break;
    case "list": node.props.items.forEach(add); break;
    case "steps": add(node.props.current); break;
    case "table": node.props.rows.forEach((row) => row.forEach(add)); break;
    case "bar": case "line": node.props.series.forEach(({ values }) => values.forEach(add)); break;
    case "button": {
      const { action, disabled } = node.props;
      add(disabled);
      if (action.kind === "set") {
        names.add(action.name);
        add(action.value);
      } else if (action.kind === "draft") {
        action.values?.forEach(add);
      }
      break;
    }
  }
  return names;
}
