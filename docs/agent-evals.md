# Agent P1 评测与观测

这份文档定义 P1 的可重复验收方式。评测任务与运行指标都只保留匿名化、结构化数据；不得写入或上传学生资料原文、提示词、凭据、审批令牌、完整 URL 或工具结果正文。

## 评测集

`src/lib/agent/evals/dataset.ts` 固定提供 32 条匿名用例，覆盖：

- 6 条资料问答；
- 4 条来源不足时的拒答；
- 4 条项目快捷任务；
- 5 条 Skill 路由；
- 4 条危险工具审批；
- 4 条工具失败恢复；
- 5 条模型路由。

每条用例都声明所需要点、禁止操作、预期来源、积分上限，以及审批和恢复契约。先检查数据集：

```bash
npm run eval:agent -- --validate-dataset
```

执行真实但已脱敏的评测后，将每条结果写成 JSON 数组或 JSONL。每行使用以下结构：

```json
{
  "caseId": "material-qa-01",
  "answer": "用于本地验收的模型回答",
  "toolIds": ["project_rag.search"],
  "sourceIds": ["network-course-v1"],
  "creditsConsumed": 12,
  "approvalRequested": false,
  "recoveredFromToolFailure": false,
  "skillId": "exam-extract",
  "provider": "deepseek"
}
```

单次报告：

```bash
npm run eval:agent -- --results ./eval/current.jsonl
```

任何 Prompt、模型或检索变更前后，必须使用同一份 32 条任务集比较：

```bash
npm run eval:agent -- \
  --baseline ./eval/baseline.jsonl \
  --candidate ./eval/candidate.jsonl
```

命令会输出成功率、来源命中、工具选择、审批/恢复正确率和平均积分的前后数值；成功率等质量指标下降、或平均积分上升，会被列入 `regressions`。

## 在线运行指标

每个聊天 Run 结束时，运行时会将一条带稳定 `runId` 的白名单化指标写入本地 `AgentAuditLog`：成功/取消状态、首 token 与总耗时、审批请求、同工具重试/恢复、工具成功/失败、检索命中、积分估算和模型路由。记录不含用户提示、资料标题或正文、工具结果、URL、错误正文和审批令牌；所有 Agent 审计事件同样按事件类型白名单化，不把原始工具入参或结果复制进审计日志。

已登录用户可以读取自己的近期指标：

```text
GET /api/metrics/agent-runs?days=7
```

接口返回每 Run 的脱敏指标及汇总，默认不向任何第三方观测平台发送数据。`approvalWaitRatio` 不使用流结束时的伪等待值：它通过该 Run 关联的 `ToolExecution` 从待审批创建时刻计到批准、拒绝或当前时刻，再与活跃运行时长合并计算。处于 `awaiting_approval` 的任务会明确标记为等待状态，并从成功率质量口径中排除；汇总中的 `pendingRunCount` 单独呈现。只有模型显式关联一条已失败执行的后续调用才会计为自动恢复，不把无关后续工具误报为恢复。

## 页面验收

在 `AGENT_RUNTIME_MODE=new` 下，对研究或工作流请求，聊天页须同时显示：

1. 任务计划及当前步骤；
2. Skill、检索和审批的可展开简短原因；
3. 若有危险操作，明确的“等待你的决定”状态和下方真实审批卡。

简单对话和 RAG 快捷任务不会强制显示计划。`plan.update` 只接受 1–6 条受限公开步骤，不能承载模型思维链或任何隐藏上下文。
