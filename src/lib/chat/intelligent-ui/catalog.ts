import { z } from "zod";

export const UI_SCHEMA_VERSION = 1;
export const UI_CATALOG_VERSION = 1;
const MAX_SNAPSHOT_BYTES = 32 * 1024;
const MAX_GROUP_BYTES = 14 * 1024;
const MAX_GROUPS = 8;
const MAX_NODES = 64;
const MAX_NODE_DEPTH = 6;
const MAX_TABLE_COLUMNS = 6;

const identifier = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/).refine(
  (value) => value !== "constructor" && value !== "prototype",
);
const label = z.string().trim().min(1).max(100);
const number = z.number().min(-1e12).max(1e12);
const scalar = z.union([number, z.boolean(), z.string().max(300)]);
export type Scalar = z.infer<typeof scalar>;
export type StateValue = Scalar | Scalar[];

const ref = z.strictObject({ ref: identifier });
const unary = ["not", "round", "floor", "ceil", "log2", "log10"] as const;
const associative = ["+", "*", "min", "max"] as const;
const binary = ["-", "/", "=", "!=", "<", "<=", ">", ">=", "and", "or", "at"] as const;
export type Expression =
  | Scalar
  | Scalar[]
  | z.infer<typeof ref>
  | { op: (typeof unary)[number]; args: [Expression] }
  | { op: (typeof binary)[number]; args: [Expression, Expression] }
  | { op: (typeof associative)[number]; args: Expression[] }
  | { op: "if"; args: [Expression, Expression, Expression] };
const expression: z.ZodType<Expression> = z.lazy(() => z.union([
  scalar,
  z.array(scalar).max(30),
  ref,
  z.discriminatedUnion("op", [
    z.strictObject({ op: z.enum(unary), args: z.tuple([expression]) }),
    z.strictObject({ op: z.enum(binary), args: z.tuple([expression, expression]) }),
    z.strictObject({ op: z.enum(associative), args: z.array(expression).min(2).max(6) }),
    z.strictObject({ op: z.literal("if"), args: z.tuple([expression, expression, expression]) }),
  ]),
]));

const variable = z.discriminatedUnion("kind", [
  z.strictObject({ name: identifier, kind: z.literal("number"), initial: number, min: number, max: number, step: number.positive() }),
  z.strictObject({ name: identifier, kind: z.literal("boolean"), initial: z.boolean() }),
  z.strictObject({ name: identifier, kind: z.literal("choice"), initial: identifier, options: z.array(z.strictObject({ value: identifier, label })).min(1).max(12) }),
  z.strictObject({ name: identifier, kind: z.literal("list"), initial: z.array(scalar).max(30) }),
]).superRefine((value, context) => {
  if (value.kind === "number" && (
    value.min >= value.max || !acceptsValue(value, value.initial) ||
    value.step > value.max - value.min || Math.ceil((value.max - value.min) / value.step) > 1_000_000
  )) {
    context.addIssue({ code: "custom", message: "Invalid numeric bounds" });
  }
  if (value.kind === "choice" && (!acceptsValue(value, value.initial) ||
      new Set(value.options.map(({ value }) => value)).size !== value.options.length)) {
    context.addIssue({ code: "custom", message: "Invalid choices" });
  }
});
export type Variable = z.infer<typeof variable>;

export function acceptsValue(variable: Variable, value: unknown): value is StateValue {
  switch (variable.kind) {
    case "number": return typeof value === "number" && value >= variable.min && value <= variable.max;
    case "boolean": return typeof value === "boolean";
    case "choice": return variable.options.some((option) => option.value === value);
    case "list": return value === variable.initial;
  }
}

const action = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("set"), name: identifier, value: expression }),
  z.strictObject({ kind: z.literal("reset") }),
  z.strictObject({ kind: z.literal("draft"), text: label, values: z.array(expression).max(4).optional() }),
]);

const sequence = z.strictObject({
  label,
  bind: identifier,
  frames: z.array(z.strictObject({
    segments: z.array(z.strictObject({
      label, span: number.positive(), detail: label.optional(),
    })).min(1).max(12),
    note: label.optional(),
  })).min(2).max(12),
});

const dataSource = z.enum(["demo", "project-files"]);
const table = z.strictObject({
  label, source: dataSource, columns: z.array(label).min(1).max(MAX_TABLE_COLUMNS),
  rows: z.array(z.array(expression).min(1).max(MAX_TABLE_COLUMNS)).max(30),
}).refine(({ columns, rows }) => rows.every((row) => row.length === columns.length));
const chart = z.strictObject({
  label, unit: label, source: dataSource, labels: z.array(label).min(1).max(24),
  series: z.array(z.strictObject({ label, values: z.array(expression).max(24) })).min(1).max(3),
}).refine(({ labels, series }) => series.every(({ values }) => values.length === labels.length));

function component<T extends z.ZodType>(props: T, authoring: string, children = false) {
  return { props, authoring, children };
}

export const UI_CATALOG = {
  stack: component(z.strictObject({ title: label.optional() }), '{title?} + children', true),
  group: component(z.strictObject({ title: label.optional() }), '{title?} + children，可换行', true),
  compare: component(z.strictObject({ title: label.optional() }), '{title?} + 两个 children，窄屏用纵向', true),
  disclosure: component(z.strictObject({ label }), '{label} + children，可展开', true),
  text: component(z.strictObject({ text: z.union([z.string().trim().min(1).max(1200), expression]) }), '{text:文字或 E} 简单 Markdown，链接留在正文'),
  value: component(z.strictObject({ label, value: expression, unit: label.optional(), digits: z.number().int().min(0).max(6).optional() }), '{label,value:E,unit?,digits?}'),
  list: component(z.strictObject({ items: z.array(expression).max(24), ordered: z.boolean().optional() }), '{items:E[],ordered?}'),
  sequence: component(sequence, '{label,bind,frames:[{segments:[{label,span,detail?}],note?}]}。仅用于按比例展示区间拆分或分配。必须在 state 声明绑定的 number，初值和最小值为 0，最大值为帧数减 1，步长为 1。自带前后切换和分段明细'),
  steps: component(z.strictObject({ items: z.array(label).min(1).max(20), current: expression.optional() }), '{items:文字[],current?:E}。普通算法和操作步骤用 steps，current 从 0 开始，可与滑杆共用索引'),
  table: component(table, `{label,source:"demo",columns:文字[],rows:E[][]}。最多 ${MAX_TABLE_COLUMNS} 列，每行格数相同。数组等较长序列用行展示`),
  bar: component(chart, '{label,unit,source:"demo",labels:文字[],series:[{label,values:E[]}]}'),
  line: component(chart, '{label,unit,source:"demo",labels:文字[],series:[{label,values:E[]}]}'),
  input: component(z.strictObject({ label, bind: identifier }), '{label,bind}，绑定 number'),
  slider: component(z.strictObject({ label, bind: identifier }), '{label,bind}，绑定 number'),
  select: component(z.strictObject({ label, bind: identifier }), '{label,bind}，绑定 choice'),
  checkbox: component(z.strictObject({ label, bind: identifier }), '{label,bind}，绑定 boolean'),
  button: component(z.strictObject({ label, action, disabled: expression.optional() }), '{label,disabled?:E,action:{kind:"set",name,value:E}|{kind:"reset"}|{kind:"draft",text,values?:E[]}}'),
} as const;

type Catalog = typeof UI_CATALOG;
type ComponentType = keyof Catalog;
export type UINode = {
  [Type in ComponentType]: {
    id: string;
    type: Type;
    props: z.infer<Catalog[Type]["props"]>;
    when?: Expression;
    children?: UINode[];
  };
}[ComponentType];

const rawNode = z.strictObject({
  id: identifier, type: z.enum(Object.keys(UI_CATALOG) as ComponentType[]),
  props: z.unknown(), when: expression.optional(), children: z.array(z.unknown()).max(24).optional(),
});
const groupSchema = z.strictObject({
  id: identifier, state: z.array(variable).max(12).optional(), when: expression.optional(), nodes: z.array(z.unknown()).min(1).max(24),
});

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
function withinBudget(root: unknown, maxBytes: number): boolean {
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

function readNode(raw: unknown, depth: number, ids: Set<string>, state: Map<string, Variable>): UINode | null {
  if (depth > MAX_NODE_DEPTH || ids.size >= MAX_NODES) return null;
  const parsed = rawNode.safeParse(raw);
  if (!parsed.success) return null;
  const { id, type, props, when, children } = parsed.data;
  if (ids.has(id) || (children?.length && !UI_CATALOG[type].children) ||
      (UI_CATALOG[type].children && !children?.length) ||
      (type === "compare" && children?.length !== 2)) return null;
  const parsedProps = UI_CATALOG[type].props.safeParse(props === undefined && UI_CATALOG[type].children ? {} : props);
  if (!parsedProps.success) return null;
  const node = { id, type, props: parsedProps.data, ...(when !== undefined && { when }) } as UINode;
  if ([...nodeRefs(node)].some((name) => !state.has(name))) return null;
  if ((node.type === "slider" || node.type === "input") && state.get(node.props.bind)?.kind !== "number") return null;
  if (node.type === "sequence") {
    const variable = state.get(node.props.bind);
    if (variable?.kind !== "number" || variable.min !== 0 || variable.max !== node.props.frames.length - 1 ||
        variable.step !== 1 || !Number.isInteger(variable.initial)) return null;
  }
  if (node.type === "select" && state.get(node.props.bind)?.kind !== "choice") return null;
  if (node.type === "checkbox" && state.get(node.props.bind)?.kind !== "boolean") return null;
  if (node.type === "button" && node.props.action.kind === "set" && state.get(node.props.action.name)?.kind === "list") return null;
  ids.add(id);
  if (children?.length) {
    node.children = [];
    for (const child of children) {
      const normalized = readNode(child, depth + 1, ids, state);
      if (!normalized) return null;
      node.children.push(normalized);
    }
  }
  return node;
}

/** Authoring groups may bind their own or earlier variables. Each append stays usable by itself. */
export function readUIGroup(raw: unknown, previous: readonly UIGroup[]): UIGroup | null {
  if (previous.length >= MAX_GROUPS || !withinBudget(raw, MAX_GROUP_BYTES)) return null;
  const parsed = groupSchema.safeParse(raw);
  if (!parsed.success || previous.some(({ id }) => id === parsed.data.id)) return null;
  const state = new Map(previous.flatMap((group) => (group.state ?? []).map((value) => [value.name, value] as const)));
  for (const value of parsed.data.state ?? []) {
    if (state.has(value.name)) return null;
    state.set(value.name, value);
  }
  const predicate = parsed.data.when;
  if ([...expressionRefs(predicate)].some((name) => !state.has(name))) return null;
  const ids = new Set<string>();
  const collect = (node: UINode) => {
    ids.add(node.id);
    node.children?.forEach(collect);
  };
  previous.forEach(({ nodes }) => nodes.forEach(collect));
  const nodes: UINode[] = [];
  for (const rawNode of parsed.data.nodes) {
    const node = readNode(rawNode, 1, ids, state);
    if (!node) return null;
    if (predicate !== undefined) {
      node.when = node.when === undefined ? predicate : { op: "and", args: [predicate, node.when] };
    }
    nodes.push(node);
  }
  const group = { id: parsed.data.id, ...(parsed.data.state?.length && { state: parsed.data.state }), nodes };
  return encoder.encode(JSON.stringify(group)).length <= MAX_GROUP_BYTES &&
    encoder.encode(JSON.stringify([...previous, group])).length <= MAX_SNAPSHOT_BYTES - 200 ? group : null;
}

const surfaceSchema = z.strictObject({
  schemaVersion: z.literal(UI_SCHEMA_VERSION),
  catalogVersion: z.literal(UI_CATALOG_VERSION),
  surfaceId: z.string().min(1).max(120),
  groups: z.array(z.unknown()).min(1).max(MAX_GROUPS),
});

export function readUISurface(raw: unknown): UISurface | null {
  if (!withinBudget(raw, MAX_SNAPSHOT_BYTES)) return null;
  const parsed = surfaceSchema.safeParse(raw);
  if (!parsed.success) return null;
  const groups: UIGroup[] = [];
  for (const entry of parsed.data.groups) {
    const group = readUIGroup(entry, groups);
    if (!group) return null;
    groups.push(group);
  }
  return makeSurface(parsed.data.surfaceId, groups);
}
