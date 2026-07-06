---
name: exam-extract
description: 考点分析：大纲驱动的 8 字段考点抽取，支持 triage 模式按权重排序。适用场景：考前划重点、从课件 PPT 提取考点、时间紧张时的优先级复习。
---

# exam-extract - 考题要点抽取

激活条件：用户提供了考试范围（syllabus / topics）+ 项目里有学习资料（PDF 或已解析文本）。

## 抽取目标（每个 syllabus topic）

从用户提供的资料中严格抽取：

1. **Definition**：1 句话定义（考试可直接写）
2. **Key Points**：3-5 条要点（阅卷老师期望看到的）
3. **Keywords**：在答案里要用到的关键词（用 **加粗** 标注）
4. **Diagram**：若有图，说明图展示什么、应标什么（2 行）
5. **Exam Line**：1-2 句考试可以直接抄的句子
6. **MCQ Trick**：仅当考试为选择题时给出（如何识别正确答案 / 排除干扰项）
7. **Cross-references**：若本 topic 的关键词在另一 topic 也出现，标记
8. **Practice Question**：1 条 examiner-style 练习题

## 严格规则

- **仅**从用户资料里抽取。不在资料中的内容宁可不写。
- **绝不**告诉学生「去看第 X 章」-- 给他们需要的全部信息。
- **绝不**补充任何外部知识。
- 资料中没有的 topic → 明确说「本 topic 在你的资料中未找到，请检查资料。」
- PDF 与 syllabus topic 名称不一致时 → 用 PDF 实际名称，但标注「你的笔记里把这个讲成 X」。

## 缺失输入处理

- 没有学习资料 → 说"请先分享你的笔记或 PDF。我不会用外部知识。"
- 没有 syllabus → 说"请列出你的考试范围（topics），确保我覆盖到所有考点。"
- 考试类型未说明 → 默认按论述题格式，但追加问一句"这是选择题还是笔试？"
- topic 在资料中未找到 → 说"本 topic 在你的资料中未找到，请检查资料。"

## Triage mode（时间紧张时）

若用户说「我只有 X 小时」：

1. **先输出 priority list**：按以下公式排序所有 syllabus topic：
   - 显式权重（syllabus 中注明的分数占比）
   - 在 PDF 中出现频次（覆盖率越高 = 优先级越高）
   - 子主题广度（涉及子主题越多 = 优先级越高）
2. 按优先级展开，不按 syllabus 顺序
3. 时间 ≤1 小时：每 topic 只输出 Definition + Key Points + Exam Line，跳过 Diagram 和 MCQ Trick
4. 时间 1-3 小时：保留 Diagram，跳过 Cross-references
5. 时间 >3 小时：完整输出

## 输入格式（缺失时必问）

1. 学习资料（PDF file_id 或粘贴笔记）
2. Syllabus（粘贴文本或 topic 列表）
3. 可选：考试类型（MCQ / short-answer / long-answer）+ 时间

## 输出格式（每个 topic）

```markdown
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
```

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
- 全部调用 `project_rag.search` + `project_files.read` 获取资料，绝不编；
- 输出用 `artifact.save`（type=quick_memory 或 type=review_outline）；
- 不删除资料，不外发任何内容。
