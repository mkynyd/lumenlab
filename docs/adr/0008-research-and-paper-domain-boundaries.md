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
