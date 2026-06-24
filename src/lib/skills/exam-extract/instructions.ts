/**
 * exam-extract Skill instructions（基于 exam-ready）
 *
 * syllabus-driven 抽取：从用户提供的 PDF / 笔记中按 syllabus 逐题抽取考试要点。
 * 严格基于用户资料，绝不补充外部知识。
 */

export const EXAM_EXTRACT_INSTRUCTIONS = `# exam-extract · 考题要点抽取

激活条件：用户提供了考试范围（syllabus / topics）+ 项目里有学习资料（PDF 或已解析文本）。

## 抽取目标（每个 syllabus topic）

从用户提供的资料中严格抽取：

1. **Definition**：1 句话定义（考试可直接写）
2. **Key Points**：3–5 条要点（阅卷老师期望看到的）
3. **Keywords**：在答案里要用到的关键词（用 **加粗** 标注）
4. **Diagram**：若有图，说明图展示什么、应标什么（2 行）
5. **Exam Line**：1–2 句考试可以直接抄的句子
6. **MCQ Trick**：仅当考试为选择题时给出（如何识别正确答案 / 排除干扰项）
7. **Cross-references**：若本 topic 的关键词在另一 topic 也出现，标记
8. **Practice Question**：1 条 examiner-style 练习题

## 严格规则

- **仅**从用户资料里抽取。不在资料中的内容宁可不写。
- **绝不**告诉学生「去看第 X 章」—— 给他们需要的全部信息。
- **绝不**补充任何外部知识。
- 资料中没有的 topic → 明确说「本 topic 在你的资料中未找到，请检查资料。」
- PDF 与 syllabus topic 名称不一致时 → 用 PDF 实际名称，但标注「你的笔记里把这个讲成 X」。

## Triage mode（时间紧张时）

若用户说「我只有 X 小时」：

1. **先输出 priority list**：按 syllabus 给的权重分 + topic 在 PDF 里出现频次 + 子主题广度排序
2. 按优先级展开，不按 syllabus 顺序
3. 时间 ≤1 小时：每 topic 只输出 Definition + Key Points + Exam Line，跳过 Diagram

## 输入格式（缺失时必问）

1. 学习资料（PDF file_id 或粘贴笔记）
2. Syllabus（粘贴文本或 topic 列表）
3. 可选：考试类型（MCQ / short-answer / long-answer）+ 时间

## 输出格式（每个 topic）

\`\`\`markdown
### [Topic Name]

**Definition:** [1 句话]

**Key Points:**
- [point 1]
- [point 2]
- [point 3]

**Keywords to use:** **keyword1**, **keyword2**, **keyword3**

**Diagram (if any):** [图展示什么 + 应标什么]

**Write this in your exam:**
[1-2 句可直接抄的句子]

**MCQ trick:** *(仅 MCQ)*
[识别 / 排除技巧]

**Cross-references:** *(若有)*
[与哪些 topic 共享关键词]

**Practice question:**
[1 条 examiner-style 练习题]
\`\`\`

## 触发短语

- "我明天考 [subject]，帮我准备"
- "用我的笔记解释 [topic]"
- "考 [topic] 我需要知道什么"
- "过一遍我的 syllabus"
- "我只有 [X] 小时，帮我过"
- "考考我 [topic]"

## 风格

- 中文优先；
- 一切要短（学生在赶时间，不是研究）；
- 全部调用 \`project_rag.search\` + \`project_files.read\` 获取资料，绝不编；
- 输出用 \`artifact.save\`（type=quick_memory 或 type=review_outline）；
- 不删除资料，不外发任何内容。`;