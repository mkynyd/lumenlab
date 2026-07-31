# LumenLab 学习闭环 P1 迭代执行计划

> 状态：执行中（P1-A 已完成，P1-B–P1-E 待执行）
> 决策冻结：2026-08-01
> 基线提交：`af57d83`
> 前置合同：`docs/learning-loop-p0-iteration-plan.md`

## 1. 目标

P1 不再扩充入口数量，而是把 P0 已产生的学习证据变成可维护、可解释、可纠正和可导出的长期资产：

1. 学习档案能解释“系统为什么这样判断”，并允许人工纠正和重置；
2. 来源从文件级推进到页码、段落、块位置与解析质量；
3. Study Pack 以确认大纲和独立章节为单位生成、重试、重做和导出；
4. 学习质量使用 LumenLab 自身 baseline/candidate 门禁，而不是复制 DeepTutor 指标。

产品入口仍只有一级 `/learning`。Project 继续拥有资料和学习数据，Learning Workspace 只负责跨项目组织与展示。

## 2. 已确认的产品决定

- 同一题重做仍是有效复习证据，不强制生成变式题。
- 错题答对后进入“已解决”，不从历史中消失。
- 掌握状态使用离散状态和证据，不展示伪精确百分比。
- 学习日历和进度展示必须有文字等价信息，不能只依赖颜色。
- 学习档案只接受 Goal、Scope、Attempt、Evaluation、Review、人工修正和资料 freshness 等显式学习事实；普通聊天不自动进入永久画像。
- 人工修正追加新记录，不覆盖模型原记录。
- “清除画像”建立 reset boundary：旧证据不再影响当前结论和推荐，但仍保留在审计历史；彻底删除由 Goal/Project 生命周期承担。
- Study Pack 必须先确认大纲，再分节生成；用户编辑过的章节不被自动覆盖。
- P1 长任务继续复用 AgentExecution，不新建第二套任务运行时。

## 3. 当前基线与缺口

| 能力 | 当前已有 | P1 缺口 |
|---|---|---|
| 学习证据 | Attempt 追加写、Evaluation supersession、Progress projector | 用户可见的证据链、有效评判标识、人工纠正入口 |
| 错因纠正 | `AttemptErrorTypeCorrection` 模型和 projector 支持 | 所有权 API、幂等写入、UI 与历史展示 |
| 学习档案 | Goal、进度、错题、复习分别可查 | 一个可解释的档案读模型、弱点结论与 reset boundary |
| 来源 | SourceAnchor、fingerprint、file/chunk 关联 | 统一 locator schema、页码/段落/块位、解析质量和可点击定位 |
| 重建 | 文件变化可局部标记 `needs_revalidation` | 新索引原子切换、上一可用版本、单文件重试与覆盖原因 |
| 成果 | Artifact 与 Markdown/DOCX/PDF 导出 | Study Pack/Section 生命周期、确认大纲、局部重做与陈旧传播 |
| 长任务 | AgentExecution、Worker、checkpoint、replay | Study Pack generation checkpoint 和章节级恢复 |
| 质量门禁 | 学习安全/确定性 eval fixtures | baseline/candidate、真实 Provider 定时任务、聚合指标 |

## 4. 领域合同

### 4.1 Learning Profile

Learning Profile 是服务端生成的读模型，不是新的真相表。每条结论必须包含：

- 结论对象：Goal 或 Knowledge Point lineage；
- 当前状态：mastery、review、freshness；
- evidence：Attempt、有效 Evaluation、Review 或 Manual Correction；
- policy/model 版本与发生时间；
- Source Anchor；
- reset boundary 之后是否仍有效。

### 4.2 Manual Learning Correction

第一阶段支持错因纠正；第二阶段支持判定纠正和 Goal 内容修正。

- 错因纠正写入 `AttemptErrorTypeCorrection`；
- 判定纠正新增一条 `AttemptEvaluation`，通过 `supersedesEvaluationId` 串成单链；
- Goal 内容修正保存 revision，不把标题改动伪装成模型结论；
- 所有写入都要求 user/project/goal/evaluation 归属一致和幂等键；
- 出现 evaluation fork 时 fail closed，不更新掌握投影。

### 4.3 Learning Profile Reset

新增 reset event，scope 为单个 Knowledge Point、单个 Goal 或当前用户全部学习画像。投影只消费 reset cutoff 之后的证据；历史 UI 将更早证据放入“重置前记录”。context summary、profilePrompt 和普通聊天不能绕过 reset event。

### 4.4 Study Pack

Study Pack 归属一个 Project 和 Learning Goal，包含 Outline 与多个 Section：

- Outline 必须显式确认后才能批量生成；
- Section 状态为 `draft / queued / generating / ready / failed / stale`；
- 每节保存 source anchors、source fingerprint、generation metadata 和用户编辑版本；
- 自动重做创建新版本，不能覆盖用户编辑；
- 最终把确认版本组装为现有 Artifact，再复用 Markdown/DOCX/PDF 导出。

## 5. API 合同

### 5.1 P1-2 学习档案

| 路由 | 方法 | 作用 |
|---|---|---|
| `/api/projects/[id]/learning/goals/[goalId]/history` | GET | 返回 Goal、状态摘要、Knowledge Point 与可回链 evidence |
| `/api/projects/[id]/learning/goals/[goalId]/evaluations/[evaluationId]/error-type-corrections` | POST | 追加人工错因纠正 |
| `/api/projects/[id]/learning/goals/[goalId]/evaluations/[evaluationId]/regrades` | POST | 追加 superseding Evaluation |
| `/api/projects/[id]/learning/goals/[goalId]/revisions` | POST | 修正 Goal 内容并保留 revision |
| `/api/projects/[id]/learning/goals/[goalId]/profile-resets` | POST | 重置当前 Goal 或指定 point 的画像 |
| `/api/learning/profile-resets` | POST | 重置当前用户全部学习画像 |

公开 history 响应禁止包含 Answer Criteria、provider 原始提示或 generation metadata。作答后可返回用户自己的答案、题面、判定理由、置信度和来源。

### 5.2 P1-1 Study Pack

| 路由 | 方法 | 作用 |
|---|---|---|
| `/api/projects/[id]/learning/goals/[goalId]/study-packs` | GET/POST | 列表或创建大纲草案 |
| `/api/projects/[id]/learning/study-packs/[packId]/outline` | PATCH | 修改/确认大纲 |
| `/api/projects/[id]/learning/study-packs/[packId]/generate` | POST | 创建或恢复 AgentExecution |
| `/api/projects/[id]/learning/study-packs/[packId]/sections/[sectionId]` | GET/PATCH | 读取或保存用户编辑 |
| `/api/projects/[id]/learning/study-packs/[packId]/sections/[sectionId]/regenerate` | POST | 只重做单节 |
| `/api/projects/[id]/learning/study-packs/[packId]/publish` | POST | 组装 Artifact |

## 6. 执行顺序

### Wave P1-A：可解释历史第一切片

- 新增 history DTO、所有权查询和 API；
- 展示 Goal、掌握/复习/陈旧状态、作答证据、有效评判和来源；
- 新增错因修正 API、幂等测试、越权测试；
- `/learning` 新增“档案”页签，修正后立即刷新档案与错题；
- learner-facing copy 不暴露原始枚举和内部 reason code。

验收：每个非 `new` 结论至少能展开一条 evidence；纠正后 effective error type 立即变化，原 Evaluation 仍可见。

完成记录（2026-08-01）：

- 已新增 ownership-scoped history API 与人工错因修正 API；幂等重试复用同一结果，复用幂等键但更改内容返回冲突。
- `/learning` 已加入「档案」页签，按知识点展示掌握、复习、资料 freshness、可展开作答证据、当前有效判定和文件页码/段落/块位。
- 人工修正追加保存并立即刷新档案与错题；被 supersede 的 Evaluation 及其修正不再影响当前投影，判定链 fork 时 fail closed。
- learner-facing DTO 不返回 Answer Criteria、rubric 或 generation metadata；前端枚举和 reason code 均转换为中文说明。
- 验收通过：全量单元测试 `216` 文件 / `1164` 项、PostgreSQL 集成测试 `3` 文件 / `15` 项；Lint、TypeScript、Next.js 生产构建和 `git diff --check` 全绿。真实浏览器覆盖桌面、`390×844` 移动端、证据展开和修正提交，无水平溢出或新增控制台告警。

### Wave P1-B：判定/Goal 修正与画像重置

- evaluation regrade 单链和并发防 fork；
- Goal revision；
- point/goal/user reset event 与 projector cutoff；
- context assembler 只读取 reset 后服务端投影；
- 删除/重置/旧摘要复活回归测试。

验收：重置后当前状态回到无证据投影，旧 context summary 不得恢复弱点；历史中明确区分重置前记录。

### Wave P1-C：精细来源与原子重建

- 冻结 locator v2：page、paragraph、block、character range、content fingerprint；
- DocumentPipeline 输出解析质量和稳定 block key；
- 构建新索引版本，完整成功后事务切换 active version；
- 单文件失败保留上一版本并支持重试；
- 覆盖报告区分 `material_absent` 与 `retrieval_miss`。

验收：来源可定位；低质量解析不能产生高置信度题目；失败重建不破坏上一可用索引。

### Wave P1-D：Study Pack

- additive schema 与状态机；
- 大纲确认 UI；
- Section 级 AgentExecution checkpoint、重试、局部重做和 stale 传播；
- 组装 Artifact 并验证 Markdown/DOCX/PDF 结构一致。

验收：未确认大纲不能批量生成；任一节失败只重试该节；用户编辑不被自动重做覆盖；中断后可恢复。

### Wave P1-E：学习质量发布门禁

- 固定课程 fixtures 和 anonymized run manifest；
- baseline/candidate 按 provider/model/item type/failure stage 聚合；
- 真实 Provider 只由手动或定时 workflow 触发；
- 输出量指标与学习效果 proxy 分开；
- CI 继续只跑确定性、安全和 schema 门禁。

验收：候选版本若出现答案泄漏、越权、来源下降、错误投影或幂等回归则阻止发布。

## 7. 并行修改边界

主 Agent 始终拥有共享合同和集成：

- `prisma/schema.prisma`、`prisma/migrations/**`；
- `src/lib/api/types.ts`、`src/lib/query-keys.ts`；
- `src/lib/learning/contracts.ts`、`services/learning-service.ts`；
- `src/components/learning/learning-page-client.tsx`；
- `REPOSITORY_INDEX.md`、README、计划、工作区总结和日志。

可并行派遣的独立分类：

| Lane | owns | must not touch | 交付 |
|---|---|---|---|
| History UI | `learning-history*.tsx` | schema、service、query keys、page client | 组件、交互和 RTL 测试 |
| Study Pack UI | `study-pack/**` | Artifact 服务、Agent runtime | 大纲/章节 UI 和测试 |
| Source audit | `learning/source-v2/**` 与 fixtures | parse-job、schema | locator/quality 纯函数与测试 |
| Quality eval | `learning/evals/p1/**` 与 scripts | runtime、生产 API | baseline/candidate runner 和报告 |
| Cross-review | 只读 | 所有文件 | 风险清单和缺失测试，不直接改共享路径 |

每个并行任务都必须声明 `owns / must_not_touch / depends_on / deliverables / acceptance / integration_owner`。主 Agent 在每个 Wave 后统一审 diff、接共享合同并跑全量门禁。

## 8. 安全与隐私门禁

- history/correction/reset 的每一级 ID 都重新校验 user → project → goal → attempt/evaluation 归属；
- pre-submit API 继续不返回答案、解析或 rubric；
- 人工修正不能构造跨 Attempt 的 supersession；
- correction/reset 写入有幂等键和冲突语义；
- 日志不记录用户答案全文、rubric 全文或学习画像内容；
- 真实 Provider eval 只保存脱敏聚合，不把用户原始资料复制进 fixture；
- Feature Flag 关闭时所有新增 learning API fail closed。

## 9. 验证矩阵

每个 Wave 至少执行：

1. 领域纯函数与服务单元测试；
2. 路由 auth、rollout、strict JSON、404/409、跨租户测试；
3. React Testing Library 的 loading/empty/error/success/mutation 状态；
4. `npm test`、`npm run lint`、`npx tsc --noEmit`、`npm run build`；
5. 桌面和 390×844 移动端真实浏览器核心流程；
6. `git diff --check` 和答案泄漏/密钥/PII 扫描；
7. schema Wave 额外执行 Prisma validate、空库迁移和现有库迁移演练。

## 10. 提交与发布

建议按可回滚切片提交：

```text
docs: freeze learning p1 execution contract
feat: add explainable learning history
feat: add manual learning corrections and profile resets
feat: add precise learning sources and atomic rebuilds
feat: add resumable study packs
test: add learning p1 release gates
```

每个绿色切片直接推送 `origin/main`。生产部署仍遵循仓库规则：只有用户明确要求部署时，才执行生产迁移与 `scripts/deploy.sh deploy <sha>`。
