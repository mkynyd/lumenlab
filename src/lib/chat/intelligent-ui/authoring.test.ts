import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { IntelligentUIAuthoring, permitsIntelligentUI } from "./authoring";
import { makeSurface, readUIGroup, readUISurface } from "./catalog";
import { ChatUIStream } from "./client-state";
import { evaluate } from "./expression";
import { projectFilesForUI } from "./project-data";

const group = {
  id: "inputs",
  state: [{ name: "windowSize", kind: "number", initial: 4, min: 1, max: 10, step: 1 }],
  nodes: [{ id: "s", type: "slider", props: { label: "窗口", bind: "windowSize" } }],
};
const result = {
  id: "result", nodes: [{ id: "r", type: "value", props: { label: "结果", value: { op: "*", args: [{ ref: "windowSize" }, 2] } } }],
};
const open = ":::lumen-ui v1\n";
const close = ":::end-lumen-ui\n";
const groupLine = (x: unknown) => JSON.stringify(x) + "\n";

describe("host intelligence UI contract", () => {
  it("publishes a fully validated group before the model ends at every split point", () => {
    const source = "正文。\n" + open + groupLine(group);
    for (let split = 0; split <= source.length; split++) {
      const parser = new IntelligentUIAuthoring();
      const head = parser.push(source.slice(0, split));
      const tail = parser.push(source.slice(split));
      expect(head.text + tail.text).toBe("正文。\n");
      expect([...head.groups, ...tail.groups].map(({ id }) => id)).toEqual(["inputs"]);
      expect(parser.snapshot("m1")).toBeNull();
      const more = parser.push(groupLine(result) + close);
      expect(more.groups.map(({ id }) => id)).toEqual(["result"]);
      expect(parser.finish().reset).toBe(false);
      expect(parser.snapshot("m1")?.groups.map(({ id }) => id)).toEqual(["inputs", "result"]);
    }
  });

  it("preserves a fenced literal and a standalone marker without a declaration", () => {
    const source = "```text\n" + open + groupLine(group) + close + "```\n" + open + "另一段正文。\n";
    const parser = new IntelligentUIAuthoring();
    let output = "";
    for (const character of source) {
      const value = parser.push(character);
      output += value.text;
      expect(value.groups).toEqual([]);
      expect(value.prepare).toBeUndefined();
    }
    output += parser.finish().text;
    expect(output).toBe(source);
    expect(parser.snapshot("m1")).toBeNull();
  });

  it("signals a first partial group once and skips the hint for a complete group", () => {
    const serialized = groupLine(group);
    const parser = new IntelligentUIAuthoring();
    expect(parser.push("正文\n" + open).prepare).toBeUndefined();
    expect(parser.push(serialized.slice(0, 20))).toEqual({
      text: "", groups: [], reset: false, prepare: true,
    });
    expect(parser.push(serialized.slice(20, 30)).prepare).toBeUndefined();
    expect(parser.push(serialized.slice(30)).groups.map(({ id }) => id)).toEqual(["inputs"]);
    expect(parser.push(groupLine(result).slice(0, 20)).prepare).toBeUndefined();
    expect(new IntelligentUIAuthoring().push(open + serialized).prepare).toBeUndefined();
  });

  it("drops provisional UI on invalid or truncated groups and leaves the explanation", () => {
    const parser = new IntelligentUIAuthoring();
    parser.push("正文\n" + open + groupLine(group));
    expect(parser.push('{"id":"bad",oops}\n' + close + "结论\n")).toEqual({ text: "结论\n", groups: [], reset: true });
    expect(parser.snapshot("m1")).toBeNull();

    const truncated = new IntelligentUIAuthoring();
    const partial = truncated.push("正文\n" + open + groupLine(group) + '{"id":');
    expect(partial.groups).toHaveLength(1);
    expect(truncated.finish()).toEqual({ text: "", groups: [], reset: true });
    expect(truncated.snapshot("m1")).toBeNull();
  });

  it("accepts whitespace variations without publishing partial JSON", () => {
    const parser = new IntelligentUIAuthoring();
    expect(parser.push("正文\n" + open + "\n{\n").groups).toEqual([]);
    const body = JSON.stringify(group, null, 2).split("\n").slice(1).join("\n");
    const ready = parser.push(body + "\n");
    expect(ready.groups).toHaveLength(1);
    expect(ready.text).toBe("");
    parser.push(close);
    expect(parser.snapshot("m1")?.groups[0].id).toBe("inputs");
  });

  it("rejects unknown bindings, model style and action injection, duplicate IDs and deep input", () => {
    expect(readUIGroup(result, [])).toBeNull();
    const first = readUIGroup(group, [])!;
    expect(readUIGroup(group, [first])).toBeNull();
    expect(readUIGroup({ id: "untrusted", nodes: [{ id: "evil", type: "button",
      props: { label: "执行", action: { kind: "fetch", url: "https://example.test" } } }] }, [])).toBeNull();
    expect(readUIGroup({ id: "untrusted", nodes: [{ id: "evil", type: "text",
      props: { text: "Y", style: "color:red" } }] }, [])).toBeNull();
    let expr: unknown = 1;
    for (let index = 0; index < 200; index++) expr = { op: "+", args: [1, expr] };
    expect(readUIGroup({ id: "deep", nodes: [{ id: "n", type: "value", props: { label: "结果", value: expr } }] }, [])).toBeNull();
  });

  it("only fills trusted data from a projected current-round result", () => {
    const table = { id: "files", nodes: [{ id: "report", type: "table", props: { source: "project-files" } }] };
    const without = new IntelligentUIAuthoring();
    without.push(open + groupLine(table) + close);
    expect(without.snapshot("m1")).toBeNull();

    const files = projectFilesForUI({ files: [{ name: "owned.csv", sizeKb: 7, status: "parsed", id: "private-id" }] });
    const withData = new IntelligentUIAuthoring(files);
    withData.push(open + groupLine(table) + close);
    expect(withData.snapshot("m1")?.groups[0].nodes[0].props).toMatchObject({ rows: [["owned.csv", 7, "已解析"]] });
    expect(JSON.stringify(withData.snapshot("m1"))).not.toContain("private-id");

    const override = new IntelligentUIAuthoring(files);
    override.push(open + groupLine({ ...table, nodes: [{ ...table.nodes[0], props: { source: "project-files", rows: [["spoof"]] } }] }) + close);
    expect(override.snapshot("m1")).toBeNull();
  });

  it("calculates only supported operations and respects direct text requests", () => {
    expect(evaluate({ op: "at", args: [{ ref: "a" }, 1] }, () => [3, 5])).toBe(5);
    expect(evaluate({ op: "/", args: [4, 0] }, () => undefined)).toBeUndefined();
    expect(evaluate({ op: "if", args: [false, { ref: "invalid" }, 7] }, () => undefined)).toBe(7);
    expect(permitsIntelligentUI("比较两个方案，只用 Markdown")).toBe(false);
    expect(permitsIntelligentUI("只用文字描述它")).toBe(false);
    expect(permitsIntelligentUI("比较实验参数，做个可调的界面")).toBe(true);
  });

  it("deduplicates replay and verifies a final digest without refetching matching UI", async () => {
    const client = new ChatUIStream();
    const notify = vi.fn();
    client.subscribe("m1", notify);
    const first = { kind: "append" as const, messageId: "m1", attempt: 1, round: 0,
      revision: 1, from: 0, groups: [JSON.stringify(group)] };
    await client.accept(first);
    await client.accept(first);
    expect(notify).toHaveBeenCalledTimes(1);
    const original = client.get("m1");
    const digest = createHash("sha256").update(JSON.stringify(original)).digest("hex");
    const load = vi.fn();
    await client.commit({ ...first, kind: "commit", digest }, load, () => true);
    expect(load).not.toHaveBeenCalled();
    expect(client.get("m1")).toBe(original);
    client.discard("m1");
    expect(client.get("m1")).toBe(original);
  });

  it("drops an old generation and recovers a missing group from one valid history snapshot", async () => {
    const client = new ChatUIStream();
    const first = { kind: "append" as const, messageId: "m1", attempt: 1, round: 0,
      revision: 1, from: 0, groups: [JSON.stringify(group)] };
    await client.accept(first);
    await client.accept({ kind: "reset", messageId: "m1", attempt: 1, round: 0 });
    await client.accept(first);
    expect(client.get("m1")).toBeUndefined();
    await client.accept({ ...first, attempt: 2, from: 1, revision: 2, groups: [JSON.stringify(result)] });
    expect(client.get("m1")).toBeUndefined();

    const copy = readUISurface(makeSurface("m1", [readUIGroup(group, [])!]))!;
    const digest = createHash("sha256").update(JSON.stringify(copy)).digest("hex");
    const recover = vi.fn(async () => copy);
    await client.commit({ kind: "commit", messageId: "m1", attempt: 2, round: 1, revision: 1, digest }, recover, () => true);
    expect(recover).toHaveBeenCalledOnce();
    expect(client.get("m1")).toEqual(copy);
  });
});
