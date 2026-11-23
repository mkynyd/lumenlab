"use client";

import ReactMarkdown from "react-markdown";
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Expression, StateValue, UIGroup, UINode, UISurface, Variable } from "@/lib/chat/intelligent-ui/catalog";
import { acceptsValue, nodeRefs } from "@/lib/chat/intelligent-ui/surface-data";
import { evaluate, formatValue } from "@/lib/chat/intelligent-ui/expression";
import { startChatInpReporter } from "@/lib/chat/intelligent-ui/inp-reporter";

import { Sequence } from "./sequence";
import { loadChart } from "./loaders";
import { UIRenderBoundary } from "./render-boundary";
const Chart = lazy(loadChart);
type Variables = ReadonlyMap<string, Variable>;
type Draft = (text: string) => void;

class SurfaceState {
  private values = new Map<string, StateValue>();
  private versions = new Map<string, number>();
  private listeners = new Map<string, Set<() => void>>();

  read(name: string, variables: Variables) {
    const variable = variables.get(name);
    if (!variable) return undefined;
    const value = this.values.get(name);
    return acceptsValue(variable, value) ? value : variable.initial;
  }

  subscribe(names: ReadonlySet<string>, listener: () => void) {
    for (const name of names) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set());
      this.listeners.get(name)?.add(listener);
    }
    return () => {
      for (const name of names) {
        const set = this.listeners.get(name);
        set?.delete(listener);
        if (!set?.size) this.listeners.delete(name);
      }
    };
  }

  version(names: ReadonlySet<string>) {
    let version = 0;
    for (const name of names) version += this.versions.get(name) ?? 0;
    return version;
  }

  set(variable: Variable, value: StateValue | undefined, variables: Variables) {
    if (!acceptsValue(variable, value) || this.read(variable.name, variables) === value) return;
    this.values.set(variable.name, value);
    this.notify([variable.name]);
  }

  reset() {
    const names = [...this.values.keys()];
    this.values.clear();
    this.notify(names);
  }

  private notify(names: string[]) {
    const listeners = new Set<() => void>();
    for (const name of names) {
      this.versions.set(name, (this.versions.get(name) ?? 0) + 1);
      this.listeners.get(name)?.forEach((listener) => listeners.add(listener));
    }
    listeners.forEach((listener) => listener());
  }
}

const NumberField = memo(function NumberField({
  id, label, value, variable, onChange,
}: {
  id: string;
  label: string;
  value: number;
  variable: Extract<Variable, { kind: "number" }>;
  onChange: (value: number) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <label htmlFor={id} className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm">
      <span>{label}</span>
      <Input id={id} aria-describedby={editing !== null ? `${id}-error` : undefined} aria-invalid={editing !== null} type="number" min={variable.min} max={variable.max} step={variable.step}
        value={editing ?? value}
        onChange={(event) => {
          const next = event.currentTarget.valueAsNumber;
          const valid = acceptsValue(variable, next);
          setEditing(valid ? null : event.currentTarget.value);
          if (valid) onChange(next);
        }}
        onBlur={() => setEditing(null)} className="w-full min-w-0 bg-[var(--color-bg)] tabular-nums" />
      {editing !== null && <span id={`${id}-error`} className="text-xs text-muted-foreground">请输入 {variable.min} 至 {variable.max} 内的数值</span>}
    </label>
  );
});

const Node = memo(function Node({
  node, variables, state, prefix, onDraft,
}: {
  node: UINode;
  variables: Variables;
  state: SurfaceState;
  prefix: string;
  onDraft?: Draft;
}) {
  const refs = useMemo(() => nodeRefs(node), [node]);
  const subscribe = useCallback((listener: () => void) => state.subscribe(refs, listener), [refs, state]);
  const getVersion = useCallback(() => state.version(refs), [refs, state]);
  useSyncExternalStore(subscribe, getVersion, getVersion);
  const read = (name: string) => state.read(name, variables);
  const evalValue = (expr: Expression) => evaluate(expr, read);
  if (node.when !== undefined && evalValue(node.when) !== true) return null;

  const children = node.children?.map((child) => <Node key={child.id} node={child} variables={variables} state={state} prefix={prefix} onDraft={onDraft} />);
  const id = `${prefix}-${node.id}`;
  switch (node.type) {
    case "stack": case "group": case "compare": {
      const classes = node.type === "compare" ? "grid grid-cols-1 gap-5 @[35rem]:grid-cols-2" :
        node.type === "group" ? "flex flex-wrap items-start gap-4 [&>*]:min-w-0 [&>*]:basis-44" : "space-y-3";
      return (
        <div className="min-w-0 space-y-2">
          {node.props.title && <h3 className="text-sm leading-snug font-semibold break-words">{node.props.title}</h3>}
          <div className={classes}>{children}</div>
        </div>
      );
    }
    case "disclosure": return (
      <details className="min-w-0">
        <summary className="w-fit cursor-pointer rounded-md px-1.5 py-1 text-sm font-medium break-words outline-none hover:bg-[var(--color-interaction-hover)] focus-visible:bg-primary/15">{node.props.label}</summary>
        <div className="mt-2 space-y-3">{children}</div>
      </details>
    );
    case "text": return (
      <div className="text-sm leading-relaxed break-words [&_ol]:list-decimal [&_ul]:list-disc [&_li]:ms-5">
        <ReactMarkdown allowedElements={["p", "br", "em", "strong", "code", "ul", "ol", "li", "blockquote"]} unwrapDisallowed>{formatValue(evalValue(node.props.text))}</ReactMarkdown>
      </div>
    );
    case "value": return (
      <div className="min-w-0 space-y-0.5 break-words">
        <div className="text-sm text-muted-foreground">{node.props.label}</div>
        <output aria-label={node.props.label} className="text-lg font-semibold tabular-nums">
          {formatValue(evalValue(node.props.value), node.props.digits)}
          {node.props.unit && <span className="ms-1 text-xs font-normal text-muted-foreground">{node.props.unit}</span>}
        </output>
      </div>
    );
    case "list": {
      if (!node.props.items.length) return <p className="text-sm text-muted-foreground">没有可显示的条目</p>;
      const List = node.props.ordered ? "ol" : "ul";
      return (
        <List className={`space-y-1 ps-5 text-sm break-words ${node.props.ordered ? "list-decimal" : "list-disc"}`}>
          {node.props.items.map((value, index) => <li key={index}>{formatValue(evalValue(value))}</li>)}
        </List>
      );
    }
    case "sequence": {
      const variable = variables.get(node.props.bind);
      if (variable?.kind !== "number") return null;
      const index = read(variable.name);
      const current = typeof index === "number" && Number.isInteger(index) ? index : variable.initial;
      return <Sequence id={id} {...node.props} current={current}
        onChange={(next) => state.set(variable, next, variables)} />;
    }
    case "steps": {
      const current = node.props.current === undefined ? undefined : evalValue(node.props.current);
      return (
        <ol className="space-y-1 ps-5 text-sm break-words list-decimal">
          {node.props.items.map((text, index) => (
            <li key={index} aria-current={index === current ? "step" : undefined} className={index === current ? "font-semibold text-foreground" : "text-muted-foreground"}>{text}</li>
          ))}
        </ol>
      );
    }
    case "table": return (
      <div className="min-w-0 max-w-full overflow-x-auto">
        <table className="w-full min-w-max text-left text-sm">
          <caption className="mb-2 text-left font-medium">{node.props.label} <span className="text-muted-foreground">（{node.props.source === "demo" ? "演示数据" : "当前项目"}）</span></caption>
          <thead><tr>{node.props.columns.map((name, index) => <th key={index} scope="col" className="max-w-48 px-2 py-1.5 break-words">{name}</th>)}</tr></thead>
          <tbody>{node.props.rows.length ? node.props.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-t border-border/60">
              {row.map((value, index) => <td key={index} className="max-w-48 px-2 py-1.5 break-words tabular-nums">{formatValue(evalValue(value))}</td>)}
            </tr>
          )) : <tr><td colSpan={node.props.columns.length} className="px-2 py-1.5 text-muted-foreground">没有可显示的数据</td></tr>}</tbody>
        </table>
      </div>
    );
    case "bar": case "line": return (
      <UIRenderBoundary fallback={<p className="text-sm text-muted-foreground">图表暂时无法加载</p>}>
        <Suspense fallback={<p className="text-sm text-muted-foreground" role="status">正在加载图表…</p>}>
          <Chart kind={node.type} label={node.props.label} unit={node.props.unit} source={node.props.source} labels={node.props.labels}
          series={node.props.series.map(({ label, values }) => ({ label, values: values.map((expr) => {
            const result = evalValue(expr);
            return typeof result === "number" ? result : null;
          }) }))} />
        </Suspense>
      </UIRenderBoundary>
    );
    case "input": case "slider": {
      const variable = variables.get(node.props.bind);
      if (variable?.kind !== "number") return null;
      const value = read(variable.name) as number;
      const change = (value: number) => state.set(variable, value, variables);
      if (node.type === "input") return <NumberField id={id} label={node.props.label} value={value} variable={variable} onChange={change} />;
      return (
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex justify-between gap-2 text-sm break-words"><span id={id}>{node.props.label}</span><span className="tabular-nums">{formatValue(value)}</span></div>
          <Slider thumbLabelledBy={id} value={[value]} min={variable.min} max={variable.max} step={variable.step} onValueChange={([next]) => change(next)} className="min-h-6" />
        </div>
      );
    }
    case "select": {
      const variable = variables.get(node.props.bind);
      if (variable?.kind !== "choice") return null;
      return (
        <div className="min-w-0 flex-1 space-y-1.5">
          <label htmlFor={id} className="text-sm break-words">{node.props.label}</label>
          <Select value={read(variable.name) as string} onValueChange={(value) => state.set(variable, value, variables)}>
            <SelectTrigger id={id} className="w-full min-w-0 focus-visible:bg-primary/15 dark:focus-visible:bg-primary/15"><SelectValue /></SelectTrigger>
            <SelectContent>{variable.options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      );
    }
    case "checkbox": {
      const variable = variables.get(node.props.bind);
      if (variable?.kind !== "boolean") return null;
      return (
        <label htmlFor={id} className="inline-flex w-fit items-center gap-2 py-1 text-sm break-words">
          <Checkbox id={id} checked={read(variable.name) === true} onCheckedChange={(value) => state.set(variable, value, variables)} />
          {node.props.label}
        </label>
      );
    }
    case "button": {
      const { action, label, disabled } = node.props;
      const activate = () => {
        if (action.kind === "reset") state.reset();
        if (action.kind === "set") {
          const variable = variables.get(action.name);
          if (variable) state.set(variable, evalValue(action.value), variables);
        }
        if (action.kind === "draft") {
          const values = action.values?.map((value) => formatValue(evalValue(value))) ?? [];
          onDraft?.([action.text, ...values].join(" ").slice(0, 900));
        }
      };
      return (
        <Button type="button" variant="ghost" size="sm" onClick={activate}
          className="h-auto min-h-9 w-fit min-w-0 justify-start px-2.5 py-1.5 text-left break-words whitespace-normal border-0 shadow-none outline-none ring-0 focus-visible:bg-primary/15 focus-visible:ring-0"
          disabled={(disabled !== undefined && evalValue(disabled) !== false) || (action.kind === "draft" && !onDraft)}>
          {label}
        </Button>
      );
    }
  }
});

const Group = memo(function Group({
  group, variables, state, prefix, onDraft,
}: {
  group: UIGroup; variables: Variables; state: SurfaceState; prefix: string; onDraft?: Draft;
}) {
  return group.nodes.map((node) => <Node key={node.id} node={node} variables={variables} state={state} prefix={prefix} onDraft={onDraft} />);
}, (previous, next) => previous.group === next.group && previous.state === next.state &&
  previous.prefix === next.prefix && previous.onDraft === next.onDraft);

export default memo(function IntelligentSurface({ surface, onDraft }: { surface: UISurface; onDraft?: Draft }) {
  useEffect(() => {
    startChatInpReporter();
  }, []);
  const [state] = useState(() => new SurfaceState());
  const groups = useMemo(() => {
    const variables = new Map<string, Variable>();
    return surface.groups.map((group) => {
      group.state?.forEach((variable) => variables.set(variable.name, variable));
      return { group, variables: new Map(variables) };
    });
  }, [surface.groups]);

  return (
    <section aria-label="交互内容" className="@container min-w-0 max-w-full space-y-3 rounded-2xl bg-[var(--color-panel-muted)] p-3 sm:p-4">
      {groups.map(({ group, variables }) => <Group key={group.id} group={group} variables={variables} state={state} prefix={surface.surfaceId} onDraft={onDraft} />)}
    </section>
  );
});
