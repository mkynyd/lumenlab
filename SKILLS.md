# LumenLab Agent Skills

Agent 模式下已注册的内置 Skill 清单。每个 Skill 是一个受控的能力包，由服务端 Policy Engine 按 L0–L4 风险等级 + Tool allowlist + Skill 风险上限独立校验。

## Skill 总览

| Skill ID | 版本 | 来源 | 风险上限 | allowedTools | 用途 |
|----------|------|------|---------|--------------|------|
| `paper-writer` | 1.0.0 | 自研 | L2 | project_files.list / read、project_rag.search、web.search、web.fetch、artifact.save / list | 论文写作助手：读取项目资料、联网检索、整理引用、保存草稿 |
| `paper-reader` | 1.0.0 | paper-quick-reader | L3（含 export） | project_files.list / read、project_rag.search、arxiv.search / read / fetch、web.fetch、reference.add / list / attach / format、artifact.save / list / export_docx | 论文速读：三档深度（裸读 / 引导 / 精读）+ 中文输出 + 页码 provenance + 多篇对比 |
| `exam-coach` | 1.1.0 | exam-prep | L2 | project_files.list / read、project_rag.search、artifact.save / list | 复习教练：5 步循环（评估 → 计划 → 材料 → 实战 → 复盘），三档时间窗（1 周 / 2 周 / 1 月），速记卡模板 |
| `exam-extract` | 1.0.0 | exam-ready | L2 | project_files.list / read、project_rag.search、artifact.save / list | 考题要点抽取：syllabus-driven 模板，严格基于项目资料不外延，按考试类型生成 Definition / Key Points / Exam Line / MCQ Trick |
| `code-reader` | 1.0.0 | 自研 | L2 | web.fetch / search、artifact.save / list | 代码理解助手：抓取 GitHub 公开仓库、生成架构与关键路径说明 |
| `socratic-tutor` | 1.0.0 | academic-tutor | L2 | project_files.list / read、project_rag.search、artifact.save / list | 苏格拉底式学业导师：三段式引导（引导问题 → 关键提示 → 下一步建议），覆盖全学科，不直接给答案 |

## 关联的 Tool 风险等级

| Tool | 风险等级 | 审批模式 | 所属 Skill（可调用） |
|------|---------|---------|---------------------|
| `project_files.list` | L1 | auto | 全部 |
| `project_files.read` | L1 | auto | paper-writer / paper-reader / exam-coach / exam-extract / socratic-tutor |
| `project_files.delete` | L3 | ask_each | （系统级，不进 Skill allowlist） |
| `project_rag.search` | L1 | auto | paper-writer / paper-reader / exam-coach / exam-extract / socratic-tutor |
| `artifact.save` | L2 | ask_first | paper-writer / paper-reader / exam-coach / exam-extract / code-reader / socratic-tutor |
| `artifact.list` | L1 | auto | 同上 |
| `artifact.export_docx` | L3 | ask_each | paper-reader |
| `web.search` | L1 | auto | paper-writer / paper-reader / code-reader |
| `web.fetch` | L1 | auto | paper-writer / paper-reader / code-reader |
| `arxiv.search` | L1 | auto | paper-reader |
| `arxiv.read` | L1 | auto | paper-reader |
| `arxiv.fetch` | L1 | auto | paper-reader |
| `reference.add` | L2 | ask_first | paper-reader |
| `reference.list` | L1 | auto | paper-reader |
| `reference.attach` | L2 | ask_first | paper-reader |
| `reference.format` | L1 | auto | paper-reader |

## 数据流

```
user → chat route
       ↓
  Skill 激活（用户 / 系统提示指定）
       ↓
  model 发出 tool_use proposal
       ↓
  Policy Engine 校验（tool 风险 vs skill 风险上限）
       ↓
  L0–L2 → auto 执行
  L3 → require_approval → 前端 ApprovalCard → /api/agent/approve
       ↓
  Tool Executor 落库 ToolExecution 行 + 审计日志
       ↓
  结果回填给 model → 继续生成
```

## 注册入口

`src/lib/skills/registry.ts` 副作用导入即注册全部 Skill。任何模块 `import "@/lib/skills/registry";` 即可触发。