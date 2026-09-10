---
status: accepted
---

# Research and Paper are separate domains over the existing Agent execution seam

Deep Research and Paper share Project context, References, object storage and public execution events, but they have different lifecycles and sources of truth. A Research Workspace contains many durable Runs; each Run freezes its confirmed Plan and eventually creates an immutable Report Snapshot. A Paper Workspace contains exactly one structured Paper Document whose append-only versions are rendered through a locked Template Binding; Research Evidence is not automatically a Paper Reference.

Research execution references the existing `AgentExecution` lease/checkpoint/event system and uses the existing Tool Registry, Policy, approval and audit paths for source access. The Research Orchestrator owns only domain state, stage transitions, bounded fan-out and stop conditions. This keeps durable recovery in one place and prevents a second queue or hidden model-runtime contract.

This boundary is intentionally additive: the chat conversation model remains valid for existing users, while system conversations used to attach a durable execution are hidden from normal chat navigation. A report correction or additional scope creates a new Research Run, and a Paper AI edit creates a Document Patch; neither operation rewrites historical evidence or document versions.

## Addendum 2026-09-10 — Deep Research Evidence Pipeline v1（Sciverse 原生证据接入）

Research retrieval 形成三条并列 evidence channel，统一经 ToolRunner（审计、平台密钥、安全边界单一 source of truth）：

- **Web channel**：`web.search`（AnySearch → Bing RSS → DuckDuckGo）+ `web.fetch` 深读；与学术通道不构成 fallback 关系。
- **Scholarly channel**：`sciverse.search` 为 primary academic discovery；仅当 Sciverse 未配置、返回错误或空结果时回退 OpenAlex/Crossref/Semantic Scholar/PubMed 直连 adapter（保留未删）；`arxiv.*` 保留为 arXiv-specific deterministic 来源。
- **Project corpus**：`project_rag.search` / `project_files.read`。

证据链：Planner/Worker 检索 → bounded read（Sciverse 以 `filters.docIds=[docId]` 硬 scope 做 semantic_search，再以 `sciverse.read` 在命中 offset 附近读 ≤1600 code points 的有界 slice）→ `ResearchSource`（DOI 优先归并；无 DOI 依次退到 arXiv/PMID/URL/provider-scoped id）→ `ResearchSourceSnapshot`（metadata.scope 明确记录 provider/docId/offset/retrievalMethod/rawContentPersisted，bounded slice 不冒充全文）→ chunk 级 `Evidence`（locator `{kind:"sciverse", docId, chunkId, offset, pageNo}` + provenance 含 retrievalMethod/semanticScore/queryHash；原始 source text 标 `direct_quote` 而非 paraphrase）→ synthesis/verification → 不可变 `ResearchReportSnapshot`（citationMap 可从 Evidence 追溯到 Snapshot → Source，含 title/canonicalUrl/DOI/provider/locator）。

可靠性：system Evidence 写 deterministic `evidenceKey`（source identity + snapshot contentHash + locator + excerpt hash + type），`@@unique([runId, evidenceKey])` 保证 task 重跑/lease 恢复不重复；对象存储失败降级为 `rawContentPersisted=false` 的有界 excerpt，不静默丢证据；Candidate 生命周期 selected → fetched（带 researchSourceId）/ rejected。质量评估把 citationCount/influentialCitationCount/FWCI 作为 ≤0.15 的有界正向辅助信号，缺失不惩罚。

Sciverse Token 仍是 server-only 平台密钥，不进入用户 Provider Credential；一期 HTTP wire contract 未改动。meta-paper-relations、resource/vision、catalog-aware advanced filters 与 chunk-level Evidence Store 之外的能力仍属后续迭代。

## Addendum 2026-09-10 — Deep Research Claim Graph v1（Grounded Claim Extraction & Verification）

Claim 不再由 evaluating 阶段的模板句生成。`evaluating` 之后新增有界、无联网的 `research.claim_extractor` 结构化 stage（经 `runResearchModelStage`，无 web search / generic project context / Skill），只消费当前 Run 已持久化的 bounded Evidence，逐题输出 0–6 个原子 Claim 及其与真实 Evidence ID 的 `supports|contradicts|qualifies|context` 关系；证据不足允许空结果，模型不可用时不回退模板 Claim，Run 以证据级保守方式继续。

可靠性：system Claim 写 deterministic `claimKey`（extractor 版本 + Question key + 归一化语义 key），`@@unique([runId, claimKey])` 保证 durable retry / lease 恢复不重复；Question 级 evidence fingerprint 使相同 Evidence 集合重跑不再调用模型，Evidence 变化只重算受影响题目；一个 Question 的 Claim + Relation 更新在单 transaction 内完成；`userEdited=true` 的 Claim 不被自动覆盖，失去全部 active Evidence 依据的旧 system Claim 进入 `superseded` 生命周期而非物理删除。

核验是两层结构：`claim-graph.ts` 的 deterministic 下界（无有效 supports/qualifies 或仅 context 不得 verified；supports+contradicts 进入 conflicted；仅 qualifies 不得按强措辞 verified；独立来源按 canonical ResearchSource 去重；superseded/invalidated Evidence 无效，disputed Evidence 触发重新评估），`research.verifier` 只能在下界之内确认或下调，reasonCode 归一化为有限集合（sufficient_support / single_source_only / indirect_support / scope_mismatch / temporal_mismatch / mixed_evidence / contradicted / no_support / invalid_evidence / model_review）。Synthesizer 改为 Claim Graph 驱动：verified 作结论、needs_qualification 带限定、conflicted 表达冲突、unsupported 不作肯定性断言，`[E1]` 标记只取自该 Claim 实际关联的 Evidence；citationMap 复用既有 Evidence → Snapshot → Source 链路，不建第二套 Citation Store。

## Addendum 2026-09-11 — Deep Research Citation Graph v1（Scholarly Graph Expansion）

Research 在初次评估之后、Claim Extraction 之前新增有界的 `citation_expansion` durable stage（run.status 保持 `evaluating`，无新 ResearchRunStatus/ResearchTaskKind）。它只在 evaluator 判定存在证据缺口时触发：`unresolved/partially_resolved` → references+citations（找原始来源与直接证据）；resolved 但单一独立来源 → citations+related_works（找独立验证）；controversial → citations（后续修正/反驳）；时间敏感 → citations；问“最早/原始出处” → references。resolved 且独立来源充足的 Question 完全跳过。

Seed 只从已归一化为 canonical `ResearchSource` 且贡献了 active Evidence 的 scholarly paper 中确定性选取（active Evidence 贡献 > Sciverse uniqueId > DOI > 全文可访问 > 时效，citation 指标仅 ≤0.15 弱辅助）；缺 uniqueId 的 seed 允许一次精确 DOI 的 sciverse.search identity resolution，成功后合并进既有 source metadata，不做标题模糊合并。budget profile × domain profile 决定硬上限（quick：1 seed/1 relation/1 hop/1 页；comprehensive：最多 3 seed/2 relation/2 hop；law 减半），分页绝不跟随 total_pages 循环。

新增持久模型 `ResearchSourceRelation`（论文 ↔ 论文边）：`edgeKey = sha256(sourceId|relation|targetCanonicalKey)`，`@@unique([runId, edgeKey])` 保证 durable retry/重放幂等；两个 seed 指向同一 target 保留两条 edge 但 target 只归并为一个 canonical ResearchSource；target 未归一化前只保留 external identity，fetch 成功后回链 `targetSourceId`。relation item 永不直接成为 Evidence——graph target 先经 DOI/uniqueId 精确解析（arXiv DOI 零调用直连 arxiv candidate），再进入既有 candidate → bounded read → Evidence 链路，candidate metadata 记录 `discovery: "sciverse.paper_relations"` + seed/relation/hop。新 Evidence 使 Question 的 evidence fingerprint 自然变化，Claim Extraction 只重算受影响题目；Verifier 继续只看真实 ClaimEvidenceRelation，引用关系不会被当作 supports——`Claim.quality` 只新增 `citationLinkedSourceCount`/`independenceCaution` 作为来源独立性风险信号。

三种“关系”的边界：`ResearchSourceRelation`（论文间引用/被引/相关工作）、`ClaimEvidenceRelation`（Claim ↔ Evidence 语义支持）、Sciverse Paper Schema 内部 entity relation（未接入，留后续）。新 Agent 工具 `sciverse.paper_relations`（L1 read-only network，`uniqueId + relation + 有界分页`，pageSize 服务端 clamp 1–50 默认 10，page ≤ 20）遵循一期 transport 的鉴权/超时/重试边界；Research 系统编排仍不带 user-facing skillId。Sciverse canonical openapi 以 0.14.1 为准（0.14.0 → 0.14.1 仅文档措辞变化，/content 明确按 Unicode 码点；wire contract 未变）。

## Addendum 2026-09-11 — Deep Research v1 Finalization（Catalog-aware filters、Resource/Vision、产品化与 Invariant 收口）

### Catalog-aware scholarly filters

模型不再有机会构造 Sciverse 过滤条件。`sciverse.search` 只接受一个封闭键集的**高层 filter intent**（`openAccess` / `oaStatus` / `venueTypes` / `publicationTypes` / `resourceTypes` / `languages` / `publishers` / `keywords` / `doi` / `citedBy` / `topPercentile` / citation·fwci·reference 区间 / `publishedFrom|To`）；未知键直接拒绝（模型侧契约错误必须可见），字段名与操作符一律由服务器决定。

编译链是 `filter intent → server-side normalized intent → /meta-catalog 校验 → 安全 filter compiler → wire filters`：`filter-compiler.ts` 检查字段是否存在、`filterable=true`、字段声明的 operator 集合是否包含所需操作符、catalog 类型族（String/Integer/Float/Boolean/Date/List[...]）是否与值匹配，并严格 clamp 条数（advanced ≤ 6、总 filters ≤ 10）、数组长度（≤ 6）、字符串长度（≤ 120）与数值区间，未知/危险组合一律丢弃并记录 reason。目录能力仍是平台内部 introspection：不注册为 Agent tool，不进入 checkpoint，也不进入模型 prompt。

Wire 事实以 2026-09-11 对生产 API 的实测为准：原生 HTTP 只有**一个** `filters` 数组；官方 tool-layer openapi 的 `filters_advanced` 是 SDK 便利别名，直接发到 wire 会得到 `400 INVALID_REQUEST`。因此高级条件与 typed basic 条件编译进同一个 `filters`。同一轮实测还确认 `abstract` 的 `filterable=false`（`400 字段 'abstract' 不支持筛选`），因此 `abstractContains` 不再作为 filter 发送，而是折进 BM25 `query`——这修掉了一条会让整个 Sciverse 通道 400 降级的既有缺陷。

降级策略：`/meta-catalog` 以有界 TTL（15 分钟，失败负缓存 30 秒，最多 8 条）缓存；目录不可用时高级条件被整体丢弃（绝不上送未校验字段），typed basic filters 与 query 继续工作；advanced 查询返回空且存在 query 时允许**一次**受控 relaxed retry（去掉 advanced 后重发），避免复杂条件锁死 recall。domain profile 只通过「识别哪些信号」参与（medicine 识别临床证据、law 不施加预印本/临床/引用分位收敛），不硬编码无法绕过的约束。

### Resource + figure/table visual evidence

Sciverse `/resource` 提供「按正文 Markdown 中 `![alt](file_name)` 的相对路径取图」的合同，没有资源列表接口。因此链路是确定性的：`sciverse.read` 在返回的有界正文里解析图片占位（拒绝绝对路径、`..`、反斜杠、协议前缀、无目录前缀的名字），把**有界**引用（每条 slice ≤ 4 个，含 alt 与紧邻上下文）写进 slice provenance；`sciverse.resource`（新 L1 read-only 工具，server-only token，绝无 user-facing skillId）按该相对路径取回受限图片字节（≤ 4 MB，非图片或超限只回传元数据）。

视觉分析是一个独立的、有硬预算的 durable stage：`evaluating → citation_expansion → evaluating → visual_evidence → claim_extraction`。它只在 Question 仍未解决**且**问题或完成标准明确指向图表中的定量/比较结果时触发；quick profile 完全关闭（0 次调用），deep 最多 1 题 / 2 资源 / 1 次模型调用，comprehensive 最多 2 题 / 3 资源 / 2 次调用；一次模型调用覆盖最多 3 张图，**没有 per-paper / per-resource 的 LLM fan-out**。图表扫描读取也计入 fetch 预算。

视觉模型只在受控多模态 stage（新角色 `research.visual_evaluator`，同一活跃 DeepSeek 多模态模型、thinking 关闭）里看到**明确选中的资源 + 有界图注/正文上下文**，不接受通用 Project 媒体自动注入。输出必须是严格结构化 JSON（`{observations:[{statement, resourceId, pageNo?, figureNo?, tableNo?, metric?, value?, unit?, confidence, limitations?}]}`），未知 resourceId、非有限 confidence、缺失 statement、超长字段一律丢弃；模型自由 Markdown 永不成为持久证据。

模型对图表的解释是 **derived observation**，与原文陈述严格区分：新增最小 additive enum `ResearchEvidenceType.visual_observation`（迁移 `20260910181647`，`ALTER TYPE ... ADD VALUE`，PG 16 事务内安全、无列/表变更、旧 ReportSnapshot 仍可读、回滚不需要 drop）。visual Evidence 的 provenance 记录 provider/docId/resourceId/resource kind/page·figure·table locator/caption hash/analysis model/stage version/confidence/source snapshot/`rawContentPersisted` 与对象存储位置；仍必须经过 Claim Extraction → ClaimEvidenceRelation → deterministic 下界 → model verifier。

### Correctness invariants（本轮新增/加强）

- Claim 的 supports **全部**来自 `visual_observation` 时，deterministic 下界最多 `needs_qualification`（`indirect_support`）：模型读图不等于原论文直接陈述。
- Claim 的 supports **全部**来自 `metadata_only` snapshot（只读到摘要级元数据、没有正文）时同样最多 `needs_qualification`：metadata-only 来源不能作为正文事实 citation。
- 这两条都只是下界：`research.verifier` 仍然只能确认或继续下调，不能升级；有正文直接证据时行为不变。
- citationMap 按 Claim 内 Evidence 去重，并补充 `authors`/`year`，作为前端引用卡片的 source of truth（不再从正文猜来源）。
- `ResearchSourceRelation` 边只证明引用关系存在，永不成为 Evidence；`Claim.quality` 只记录 `citationLinkedSourceCount`/`independenceCaution` 风险信号。

### 运行时可观测性与产品面

run 状态机不变（无新 `ResearchRunStatus`/`ResearchTaskKind`）；UI 需要的细分阶段由 durable checkpoint 的 `researchState.stage` 派生（`resolveResearchPublicStage`），因此 citation expansion / visual evidence / claim extraction 不再共用一个模糊的「处理中」。provider 降级以稳定代码记录在 checkpoint（有界 ≤ 12 条）与 `run.metrics.degradations`，前端映射为用户语言（例如「arXiv 暂时不可用，已使用其它学术来源继续」），failed run 额外返回 `failureReason`。`run.metrics` 统一为一份计数（工具调用、来源、Evidence、graph、visual、model/tokens/cost、elapsed、budgetStopReason、degradations），阶段不再各写一套含义重叠的字段——未新增 metrics 表。
