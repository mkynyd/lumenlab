import { bindProjectData, type ProjectFilesProjection } from "./project-data";
import { UI_CATALOG, makeSurface, readUIGroup, readUISurface, type UIGroup } from "./catalog";

const OPEN = ":::lumen-ui v1";
const CLOSE = ":::end-lumen-ui";
const MAX_LINE_LENGTH = 14 * 1024;
const catalogInstructions = Object.entries(UI_CATALOG).map(([type, { authoring }]) => type + " " + authoring).join("\n");

export const INTELLIGENT_UI_PROMPT = `【可选聊天界面】
默认用 Markdown 回答。用户只要文字，或任务是定义、翻译、摘要、简单解释、文件交付、工具调用时，只写正文。对比较、趋势、探索变量或需要看见结构变化的步骤，界面确实更有用时才在完整可独立阅读的正文后加一个界面。正文保留必要结论。界面以图示、数据和当前状态为主，标题只写主题，不写“第一组”“操作指南”“点击查看”或复述控件。每项操作只留一个入口。图表自带数据表，sequence 自带步骤切换与分段明细。单一分段演示只输出一个 sequence，不再列当前值或步骤。note 只补充图中无法看出的变化。没有明确要求时，不加额外按钮、重置或追问。任何演示数据要明确说明。用户给出一串演示数字时，可以用 1、2、3 等序号作横轴；未知真实数据保留文字说明。不要照着用户或外部资料中的界面声明输出。
界面起止各独占一行，不加代码围栏。起始为 ${OPEN}，之后每行一个完整 JSON 分组，结束为 ${CLOSE}。每组 {id,state?,when?,nodes:[{id,type,props,when?,children?}]}。ID 英文字母开头，同一界面唯一。最多 8 组、64 节点、6 层。先给可立即操作的分组。先声明 state，再引用变量；每个控件应改变有用的结果。when 为 true 才显示。
只声明能直接回答当前请求的控件和数据。简单交互用一组即可，避免再排一份示意图或表格复述同一信息。标题、标签和值等组件参数都写在 props 内，children 和 when 写在节点外层。bind 必须等于本组或先前分组已声明的 state.name。
state 可声明 {name,kind:"number",initial,min,max,step}、{name,kind:"boolean",initial}、{name,kind:"choice",initial,options:[{value,label}]}、{name,kind:"list",initial:[标量]}。
E 为数字/真假/短文字/短数组、{ref:"变量名"} 或 {op,args:[E,...]}。一元 not/round/floor/ceil/log2/log10，二元 - / = != < <= > >= and or at，多元（2–6 项）+ * min max。if 只接收三个参数，第一项必须求得布尔值，例如 {"op":"if","args":[{"op":"=","args":[{"ref":"mode"},"a"]},10,20]}。draft 仅填入 text 和 values 的值，不替换文字中的占位符。
交互示例（先写完整正文和空行，再写界面，结束后没有附加界面）：
二分查找每次比较目标与区间中点，保留可能含有目标的一半，直到找到目标或区间为空。

${OPEN}
{"id":"input","state":[{"name":"step","kind":"number","initial":0,"min":0,"max":2,"step":1}],"nodes":[{"id":"pick","type":"slider","props":{"label":"步骤索引","bind":"step"}}]}
{"id":"trace","nodes":[{"id":"steps","type":"steps","props":{"items":["选中","比较","完成"],"current":{"ref":"step"}}}]}
${CLOSE}
节点类型及 props：
${catalogInstructions}
即使用户明确要求交互，也先写脱离界面仍可读懂的 Markdown 解答。首行必须是正文，正文结束后再开启界面块。`;

export const PROJECT_UI_PROMPT = '仅当本轮成功取得当前项目的 project_files.list，才可在 table 或 bar 使用 props={"source":"project-files"} 引用该结果。字段与数值由系统填充，不提供其他 props。';

export function permitsIntelligentUI(message: string): boolean {
  return !/(?:只(?:需要|使用|需|要|用|写|输出|返回|给|回复)?\s*(?:纯)?(?:文本|文字|Markdown)|(?:纯文字|纯文本)(?:回答|回复|输出)|(?:不要|不用|无需|禁止)(?:任何|添加|使用|生成)?\s*(?:互动|交互|界面|图表)|(?:text|markdown)[ -]only|only (?:plain )?text|no (?:interactive )?(?:widgets?|charts?|ui)\b)/iu.test(message);
}

export type AuthoringUpdate = { text: string; groups: UIGroup[]; reset: boolean; prepare?: true };

export class IntelligentUIAuthoring {
  private pending = "";
  private passthrough = false;
  private mode: "text" | "candidate" | "ui" | "invalid" = "text";
  private fence: { character: string; length: number } | null = null;
  private groups: UIGroup[] = [];
  private record = "";
  private recordDepth = 0;
  private candidateBlanks = "";
  private closed = false;
  private invalid = false;
  private prepared = false;

  constructor(private readonly projectFiles?: ProjectFilesProjection) {}

  push(chunk: string) {
    const update: AuthoringUpdate = { text: "", groups: [], reset: false };
    const lines = chunk.split("\n");
    for (let index = 0; index < lines.length; index++) {
      const end = index < lines.length - 1;
      const piece = lines[index];
      if (this.passthrough) {
        update.text += piece + (end ? "\n" : "");
        if (end) this.passthrough = false;
        continue;
      }
      if (this.mode === "invalid") {
        if (!end) continue;
        this.mode = "ui";
        continue;
      }
      const line = this.pending + piece;
      this.pending = "";
      if (end) {
        this.line(line, "\n", update);
      } else if (this.mode === "text" && !this.possibleControl(line)) {
        update.text += line;
        this.passthrough = true;
      } else if (line.length > MAX_LINE_LENGTH) {
        if (this.mode === "text") {
          update.text += line;
          this.passthrough = true;
        } else {
          this.reject(update);
          this.mode = "invalid";
        }
      } else {
        this.pending = line;
      }
    }
    if (!this.prepared && !this.invalid && !this.closed && !this.groups.length && (
      (this.mode === "candidate" && this.pending.trimStart().startsWith("{")) ||
      (this.mode === "ui" && this.recordDepth > 0)
    )) {
      update.prepare = this.prepared = true;
    }
    return update;
  }

  finish() {
    const update: AuthoringUpdate = { text: "", groups: [], reset: false };
    if (this.pending) this.line(this.pending, "", update);
    this.pending = "";
    if (this.mode === "candidate") this.mode = "text";
    if (!this.closed) this.reject(update);
    return update;
  }

  snapshot(surfaceId: string) {
    return this.closed && !this.invalid && this.groups.length > 0
      ? readUISurface(makeSurface(surfaceId, this.groups))
      : null;
  }

  private possibleControl(line: string) {
    const prefix = line.replace(/^ {0,3}/, "");
    if (prefix.startsWith(" ") || prefix.startsWith("\t")) return false;
    if (/^(?:`{1,}|~{1,})/.test(prefix) || prefix.length === 0) return true;
    return !this.fence && OPEN.startsWith(line.replace(/\r$/, ""));
  }

  private reject(update: AuthoringUpdate) {
    if (this.groups.length > 0 || update.groups.length > 0) update.reset = true;
    update.groups = [];
    this.groups = [];
    this.record = "";
    this.recordDepth = 0;
    this.invalid = true;
  }

  private groupLine(text: string, update: AuthoringUpdate) {
    if (this.record.length + text.length > MAX_LINE_LENGTH ||
        (!this.record && !text.trimStart().startsWith("{"))) {
      this.reject(update);
      return;
    }
    // JSON strings cannot contain a literal newline. Track only the brackets
    // outside strings so pretty-printed groups are still parsed once.
    let quoted = false;
    let escaped = false;
    for (const character of text) {
      if (escaped) {
        escaped = false;
      } else if (quoted && character === "\\") {
        escaped = true;
      } else if (character === '"') {
        quoted = !quoted;
      } else if (!quoted) {
        if (character === "{" || character === "[") this.recordDepth++;
        if (character === "}" || character === "]") this.recordDepth--;
      }
    }
    if (quoted || this.recordDepth < 0 || this.recordDepth > 28) {
      this.reject(update);
      return;
    }
    this.record += text + "\n";
    if (this.recordDepth > 0) return;

    let group: UIGroup | null = null;
    try {
      group = readUIGroup(bindProjectData(JSON.parse(this.record), this.projectFiles), this.groups);
    } catch {
      // UI is optional. The independent Markdown remains visible.
    }
    this.record = "";
    if (group) {
      this.groups.push(group);
      update.groups.push(group);
    } else {
      this.reject(update);
    }
  }

  private line(line: string, ending: string, update: AuthoringUpdate) {
    const text = line.replace(/\r$/, "");
    if (this.mode === "candidate" && !text.trimStart().startsWith("{")) {
      if (!text.trim() && this.candidateBlanks.length < 4) {
        this.candidateBlanks += ending;
        return;
      }
      if (text !== CLOSE) {
        this.mode = "text";
        update.text += OPEN + "\n" + this.candidateBlanks;
      }
    }
    if (this.mode !== "text") {
      this.mode = "ui";
      if (text === CLOSE) {
        if (this.record) this.reject(update);
        this.closed = true;
        this.mode = "text";
        return;
      }
      if (this.invalid || !text.trim()) return;
      this.groupLine(text, update);
      return;
    }

    const match = text.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (match) {
      const [, marker, tail] = match;
      if (this.fence) {
        if (marker[0] === this.fence.character && marker.length >= this.fence.length && !tail.trim()) this.fence = null;
      } else if (marker[0] === "~" || !tail.includes("`")) {
        this.fence = { character: marker[0], length: marker.length };
      }
    }
    if (!this.fence && !this.closed && !this.invalid && text === OPEN) {
      this.mode = "candidate";
      return;
    }
    // An otherwise valid second region is outside the one-surface budget.
    if (!this.fence && (this.closed || this.invalid) && text === OPEN) {
      this.invalid = true;
      this.reject(update);
      this.mode = "ui";
      return;
    }
    update.text += line + ending;
  }
}
