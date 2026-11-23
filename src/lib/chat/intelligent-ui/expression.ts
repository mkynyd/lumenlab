import type { Expression, StateValue } from "./catalog";

function numeric(value: number): number | undefined {
  return Number.isFinite(value) && Math.abs(value) <= 1e12 ? value : undefined;
}

export function evaluate(expression: Expression, read: (name: string) => StateValue | undefined): StateValue | undefined {
  if (typeof expression !== "object" || Array.isArray(expression)) return expression;
  if ("ref" in expression) return read(expression.ref);
  const first = evaluate(expression.args[0], read);
  switch (expression.op) {
    case "if": return typeof first === "boolean" ? evaluate(expression.args[first ? 1 : 2], read) : undefined;
    case "not": return typeof first === "boolean" ? !first : undefined;
    case "round": return typeof first === "number" ? Math.round(first) : undefined;
    case "floor": return typeof first === "number" ? Math.floor(first) : undefined;
    case "ceil": return typeof first === "number" ? Math.ceil(first) : undefined;
    case "log2": return typeof first === "number" ? numeric(Math.log2(first)) : undefined;
    case "log10": return typeof first === "number" ? numeric(Math.log10(first)) : undefined;
    case "+": case "*": case "min": case "max": {
      const values = [first, ...expression.args.slice(1).map((child) => evaluate(child, read))];
      if (!values.every((value) => typeof value === "number")) return undefined;
      if (expression.op === "+") return numeric(values.reduce((sum, value) => sum + value, 0));
      if (expression.op === "*") return numeric(values.reduce((product, value) => product * value, 1));
      return expression.op === "min" ? Math.min(...values) : Math.max(...values);
    }
  }
  const secondArg = expression.args[1];
  if (secondArg === undefined) return undefined;
  const second = evaluate(secondArg, read);
  if (expression.op === "=" || expression.op === "!=") {
    if (first === undefined || second === undefined || Array.isArray(first) || Array.isArray(second)) return undefined;
    return expression.op === "=" ? first === second : first !== second;
  }
  if (expression.op === "at") {
    return Array.isArray(first) && typeof second === "number" && Number.isInteger(second) && second >= 0 ? first[second] : undefined;
  }
  if (expression.op === "and" || expression.op === "or") {
    if (typeof first !== "boolean" || typeof second !== "boolean") return undefined;
    return expression.op === "and" ? first && second : first || second;
  }
  if (typeof first !== "number" || typeof second !== "number") return undefined;
  switch (expression.op) {
    case "-": return numeric(first - second);
    case "/": return numeric(first / second);
    case "<": return first < second;
    case "<=": return first <= second;
    case ">": return first > second;
    case ">=": return first >= second;
  }
}

const formatters = new Map<number, Intl.NumberFormat>();
export function formatValue(value: StateValue | undefined, digits = 6): string {
  if (value === undefined || Array.isArray(value)) return "不可用";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") {
    const formatter = formatters.get(digits) ?? new Intl.NumberFormat("zh-CN", { maximumFractionDigits: digits });
    formatters.set(digits, formatter);
    return formatter.format(value);
  }
  return value;
}
