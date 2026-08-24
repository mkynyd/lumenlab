# TODO

> Last updated: 2026-08-24

This document tracks the completed Agent Runtime consolidation plus deferred Skill, Tool, and production-hardening work.

## Completed Learning P1-E — Release Quality Gates

- Added `src/lib/learning/evals/p1/release-gates.ts`: 15 deterministic release-gate cases across five domains (answer leakage, authorization, source integrity, projection, idempotency), all free of user data / DB / real providers, so CI can execute them.
- Added two P1 projection golden cases: regrade supersession keeps a single active evaluation; a forked evaluation chain fails closed (`evaluation_fork` exclusion).
- Added `compareReleaseGates` baseline/candidate comparison: any gate that passed the frozen baseline but fails in the candidate blocks the release (exit 1).
- Added `scripts/evaluate-learning-release.ts` (`npm run eval:learning`): deterministic run + baseline comparison against the committed `reports/learning-release-baseline.json`, aggregated by gate / item type / failure stage; `--update-baseline` refreshes the baseline; `--provider <name> --userId <id>` is the manual real-provider workflow (fixed-course fixtures through the DeepSeek learning gateway, schema + source-handle contract checks) that CI never triggers. `scripts/tsconfig.eval.json` maps `server-only` to the test stub for script runs only.
- Run manifests are anonymized (no user data, no passwords, no content) and record environment / model / commit SHA. CI workflow unchanged.
- Verification: 1206 unit tests green, `npm run eval:learning` 15/15 with a committed baseline and no-regression exit 0; commit `257e439` pushed. P1-A through P1-E are now all complete.

## Completed Learning P1-C — Precise Sources and Atomic Rebuilds

- Frozen locator v2 as a strict discriminated union (`file` / `page` / `block` / `range`) in `validators.ts`; legacy free-form locators remain tolerated by the anchor snapshot schema.
- `buildSourceSnapshots` resolves block-annotated DocumentChunks per file (by `fileAssetId`, current parse) and promotes anchors to `{ kind: "block", blockId, pageNumber? }` with `documentChunkId` backfilled; falls back to file-level locators when no block metadata exists.
- Chunk metadata now carries a stable `blockKey` (sha256 of blockId:index:content) and a chunk-level `contentFingerprint` for cross-rebuild comparison.
- `createDocumentChunks` rebuilds atomically: delete + create run inside an interactive transaction (rollback keeps the previous index on failure); search-cache invalidation stays outside the transaction.
- New `quality-gate.ts` gates high-confidence generation (knowledge maps, diagnostic items, study pack sections) on `ParseQualityReport`: text coverage < 0.5, > 3 failed images, or > 10 warnings reject with 409; legacy files without reports pass.
- New `coverage.ts` classifies `covered` / `retrieval_miss` / `material_absent` with a corpus-wide keyword fallback; learning-domain generation errors now distinguish "material missing" from "material exists but mis-referenced".
- Verification: 1202 unit tests, 30 PostgreSQL integration tests, lint/tsc/build/diff-check green; commits `64a33d2`, `465df8f`, `3a1925f`, `33ae403` pushed to origin/main.

## Completed Runtime Consolidation

- Reduced `/api/chat` to authentication, rate limiting, request mapping, `AgentRuntime.run()`, and SSE response adaptation.
- Added a transport-independent `AgentRuntime` contract with explicit context assembly, provider adapters, persistence ports, and structured runtime events.
- Replaced the provider-specific continuation path with one `AgentLoop` used by deterministic prelude tools and model-requested tools.
- Added native DeepSeek and MiniMax round/continuation adapters. DeepSeek XML/DSML fallback parsing stays inside its adapter; MiniMax uses native tool-use/tool-result blocks.
- Added durable approval execution with token binding, atomic single-use token and execution claims, restored tool context, and terminal tool audit state.
- Added `AGENT_RUNTIME_MODE=legacy|shadow|new`; `shadow` compares side-effect-free planning decisions, while the old `AGENT_ORCHESTRATOR_ENABLED` variable remains only as a compatibility bridge.
- Preserved the public `/api/chat` request shape and SSE event protocol while adding runtime/tool protocol version headers.

## Completed Durable Execution and Learning P0

- Connected `AgentExecution` / `AgentExecutionEvent` to chat dispatch, a lease-based Worker, bounded provider-neutral checkpoints, strictly ordered event replay, approval/rejection continuation, cancel/retry routes and public run metrics.
- Added stable request hashes and event cursors so HTTP/SSE disconnects can reconnect without duplicating text, messages or already-known tool results.
- Treats stale approved-tool checkpoints as unknown outcomes and fails safely instead of blindly replaying a possible side effect.
- Completed authenticated non-production DeepSeek and MiniMax smoke paths, including approval, rejection, automatic continuation and exactly-once cumulative token-usage persistence.
- Enabled the production learning rollout together with durable execution on 2026-07-31 after an explicit release request; retained fail-safe configuration backup and verified process flags, health checks and restart stability.
- Added the Project-owned learning domain: Goal, confirmed Scope, versioned Map/Point lineage, source anchors, private answer specifications, append-only attempts/evaluations, mastery/review projection, wrong-answer history, Today and local material-freshness invalidation.
- Promoted learning to a preview-gated, first-class `/learning` workspace with Today, existing-project setup, a shadcn Base Calendar schedule, same-item wrong-answer redo and text-equivalent segmented progress. Former `/today` and `/projects/[id]/learning` URLs now preserve compatibility through redirects.
- The frozen implementation and release contract is `docs/learning-loop-p0-iteration-plan.md`.

## Completed Learning P1-A — Explainable History

- Added an ownership-scoped learning-history read model that joins each current Knowledge Point with mastery, review, freshness, source anchors, append-only attempts, the uniquely active Evaluation and human corrections.
- Added a strict, idempotent error-type correction API for the active Evaluation only. Corrections append new user evidence, preserve model output, reject cross-tenant IDs and fail closed when the Evaluation chain has no unique active result.
- Added a first-class「档案」tab with readable evidence, source locations and six learner-facing error categories; internal reason codes, answer criteria, rubric and generation metadata are not rendered.
- The frozen P1 execution contract and remaining P1-B–P1-E waves are tracked in `docs/learning-p1-iteration-plan.md`; ADR 0007 defines profile projection and reset boundaries.

## Completed Learning P1-D — Study Packs

- Added `StudyPack` / `StudyPackSection` models with the `draft/queued/generating/ready/failed/stale` state machine, user-edit versions, source fingerprints and an optional `agentExecutionId`; migration `20260801110000_study_packs`.
- Added the frozen route contract: pack list/create (outline derived from the latest Knowledge Map), outline PATCH (structure free while draft, locked once confirmed), generate (rejects unconfirmed outlines, skips ready or user-edited sections, retries failed ones), section GET/PATCH (user edits take precedence), single-section regenerate (never overwrites user edits) and publish (assembles a `review_outline` Artifact, idempotent on repeat).
- Section generation reuses `LearningModelGateway.generateStudyPackSection` (DeepSeek structured JSON, per-section Markdown); interrupted runs resume by re-running generate, which skips ready sections and retries failed ones.
- Added the「资料包」tab to the learning workspace: list/create, outline editor with confirm, per-section status and failure reasons, content view/edit, single-section redo and publish entry with an artifact link.
- The frozen contract and remaining P1-C/P1-E waves are tracked in `docs/learning-p1-iteration-plan.md`.

## Completed Learning P1-B — Verdict Corrections, Goal Revisions and Profile Resets

- Added `AttemptEvaluation.idempotencyKey` (unique per attempt), `LearningGoalRevision` snapshots and `LearningProfileReset` events with user/goal/point scopes; migration `20260801090000_learning_p1b_profile_resets`.
- Added a superseding regrade API (`/regrades`) that appends a new Evaluation through a single chain, rejects forks via the database unique constraint, is idempotent on `(attemptId, idempotencyKey)` and refuses to regrade evidence predating a reset boundary.
- Added Goal revision API (`/revisions`) that updates the Goal and keeps a human-readable snapshot with a required reason; idempotent retries short-circuit before change detection.
- Added profile reset APIs (`/profile-resets` per goal, `/api/learning/profile-resets` per user) that write a reset event and atomically reset affected projections to the empty state.
- Every projection path now consumes only evidence after the latest reset boundary (`user > goal > point`); `getHistory` returns per-point `resetAt` and per-evidence `resetBefore` so the UI marks pre-reset records and withholds correction/regrade controls on them. Old summaries cannot resurrect cleared weak points.
- Added「档案」UI: verdict correction editor, goal revision editor, point/goal/user reset controls with double-click confirmation, and「画像已重置」/「重置前记录」badges.
- The frozen contract and remaining P1-C–P1-E waves are tracked in `docs/learning-p1-iteration-plan.md`.

## Completed First Slice (historical)

- Added the original `AGENT_ORCHESTRATOR_ENABLED` feature flag. It has since been superseded by `AGENT_RUNTIME_MODE`; see the runtime consolidation above.
- Added a deterministic Skill Router for all six built-in Skills, including `awaiting_context` for missing material and regular RAG behavior for ordinary summaries.
- Added provider-neutral planned tool execution for `project_files.read`, `project_rag.search`, and `web.fetch`; `project_files.list` and `artifact.save` remain registered MVP tools for explicit follow-up actions.
- Added `Message.sources`, `Artifact.metadata`, and source aggregation/dedup so references render at the bottom of assistant messages rather than inline in the answer.
- Upgraded `web.fetch` to accept explicit public HTTP(S) URLs with SSRF checks, redirect revalidation, body limits, and HTML-to-Markdown cleanup.
- Added `scripts/seed-dev-access.ts` for reset local databases and optional four-provider user API key setup.

## Completed Stage 1 — Skill Controls & Follow-up Actions

- Extended request schema, chat request builder, and `useChat` hook with `manualSkillId` and `skillOff`.
- Updated `routeSkill()` to honor `manualSkillId` first, then `skillOff`, then deterministic rule routing.
- Added `Conversation.skillDisabled` boolean column and migration to persist the user's "off" preference.
- Updated `/api/chat` to read `manualSkillId`/`skillOff`, persist `skillDisabled`, and skip Skill routing when disabled.
- Added `SkillSelector` component and wired it into `ChatInput`/`ChatArea`.
- Added follow-up action buttons below assistant messages: `引导我深入理解`, `抓考试重点`, `生成速记卡`.
- Added/updated tests; verification: `npm test` 251 passed, `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npx prisma validate` all green.

## Agent Skills Roadmap

### MVP Scope

- Build a provider-neutral Agent path before expanding individual Skill prompts.
- Add a Skill Router that selects from all six built-in Skills:
  - `paper-reader`
  - `paper-writer`
  - `exam-extract`
  - `exam-coach`
  - `code-reader`
  - `socratic-tutor`
- Route with structured signals first. TODO: add an optional DeepSeek fast JSON classifier for low-confidence ties.
- Keep Skill activation visible in the SSE event stream and chat header status bar. DONE: added `SkillSelector` in `ChatInput` and follow-up action buttons in `MessageBubble`.
- Persist the current Skill on `Conversation`; record activation history and audit fields in `ConversationSkill`.
- Support `active` and `awaiting_context` Skill states. DONE: added durable `Conversation.skillDisabled` preference controlled from the UI.

### Deferred Skill Work

- Add a `deep-study` Skill after the first router/orchestrator slice is stable.
  - Purpose: deeper analysis of course materials, papers, or chapters.
  - Candidate outputs: concept map, prerequisite knowledge, difficult-point breakdown, examples/counterexamples, chapter connections, and recommended follow-up questions.
  - First implementation should be based on real follow-up button usage rather than speculative prompt design.
- Add follow-up action buttons after normal RAG summaries: DONE.
  - `引导我深入理解` -> use `socratic-tutor`.
  - `抓考试重点` -> use `exam-extract`.
  - `生成速记卡` -> use `exam-coach`.
  - `保存为成果` -> use `artifact.save` (already existed).
- Keep ordinary file or chapter summaries as normal RAG by default; do not auto-activate a Skill unless the user expresses a more specific study intent.

## Completed Stage 2 — Tool Expansion & Multi-round Continuation

- Extended `PlannedToolCall` to the full registered tool set.
- `buildPlannedToolCalls()` now plans `arxiv.read`, `web.search`, `project_files.list`, and `reference.list` in addition to the original `web.fetch`, `project_files.read`, and `project_rag.search`.
- Reused the existing policy/audit path via `runAutoTool` so L2/L3 planned tools emit `approval_required` events.
- Consolidated deterministic and model-requested tool execution in `src/lib/agent/loop/agent-loop.ts`, including round limits, duplicate detection, no-progress detection, approval suspension, and abort propagation.
- Wired the unified loop through `AgentRuntime`; `/api/chat` no longer owns provider or continuation logic.
- Migrated legacy RAG sources: `retrieveProjectContext()` now returns per-file sources and `/api/chat` persists them on `Message.sources` so they render in the unified bottom sources UI.

## Provider-Neutral Tools

### MVP Tools

Implemented the first provider-neutral Agent Orchestrator with these tools:

- `project_files.list`
- `project_files.read`
- `project_rag.search`
- `web.fetch`
- `web.search`
- `arxiv.read`
- `reference.list`
- `artifact.save`

### Deferred Tool Expansion

Add these after the MVP loop, approval UX, and tool-result continuation are stable:

- `project_files.delete`
- `artifact.export_docx`
- `reference.add`
- `reference.attach`
- `reference.format`
- `arxiv.search`
- `arxiv.fetch`

### Deferred Hardening

- Harden approval UX for L2/L3 tools before enabling delete/export/reference operations broadly.
- Migrate legacy non-Orchestrator RAG responses into the Agent Orchestrator path so project-file sources can be persisted and rendered through the same bottom `sources` UI as web/arXiv/artifact sources. DONE.
- Add duplicate tool-call detection: stop when the same tool and same args repeat. DONE (enforced by `AgentLoop`).
- Add no-progress detection: stop when two consecutive rounds produce no useful new tool result. DONE (enforced by `AgentLoop`).
- Add task-profile round limits:
  - `simple`: max 2 rounds
  - `rag`: max 4 rounds
  - `research`: max 6 rounds
  - `workflow`: max 10 rounds
  DONE.
- Let the Router choose the initial task profile; let the Orchestrator adjust it at most once based on actual tool behavior. TODO.
- Add multi-round model-driven continuation. DONE through provider-native round adapters and the unified `AgentLoop`.

## Completed Stage 3 — Provider Adapters

- Moved provider-specific streaming logic out of `src/app/api/chat/route.ts` into `src/lib/agent/adapters/`.
- Added `ProviderAdapter` interface and `createProviderAdapter` factory.
- Added `DeepSeekAdapter` with native tool normalization, XML/DSML fallback parsing, and continuation support.
- Added `MiniMaxAdapter` with native tool-use/tool-result normalization and continuation support.
- `AgentRuntime` selects the adapter by `modelRoute.provider` and drives it through `startRound()` / `continueRound()`.
- Provider-specific stream parsing, tool protocol details, and fallback formats remain inside adapters rather than the Runtime or route.
- `web.fetch` and `web.search` remain server-side product tools shared across providers.

## Model Provider Adapters

- Move provider-specific logic out of `src/app/api/chat/route.ts`. DONE.
- Add provider adapters that normalize DeepSeek and MiniMax streams into shared internal events. DONE.
- Support native tool calling where the provider supports it. DONE (DeepSeek and MiniMax).
- Keep provider-specific fallback parsing isolated behind adapters. DONE (DeepSeek XML/DSML fallback).
- Keep DeepSeek built-in `web_search_20250305` only as an optimization path; do not make it the only web access path. DONE.
- Make `web.fetch` and future `web.search` server-side product tools so DeepSeek, MiniMax, and future providers can share the same Agent capabilities. DONE.

## Routing Details

- Use `RoutingSignals` before keyword scoring.
- Treat Chinese courseware file names as weak signals only; many files are chapter titles or sequence numbers.
- Prefer file category and parse metadata over filename matching.
- Read short snippets or project index summaries only when routing confidence is low.
- Route course-material "抓重点 / 整理考点 / 这章怎么考" requests to `exam-extract`.
- Route time planning, weak-topic review, and sprint planning to `exam-coach`.
- For `paper-reader` missing paper input, use this prompt:

```text
请上传文档、粘贴论文编号（例如 arXiv ID ），或选择项目资料。
```

## Acceptance Checks

- After the Agent Orchestrator iteration is complete, produce a handoff document that explains the before/after diff for the user and future agents. It should cover changed request flow, Skill Router behavior, provider adapters, tool execution, sources persistence, feature flags, remaining TODOs, and verification results. DONE — see `docs/agent-orchestrator-diff.md`.
- Add a local development access setup script before final smoke testing, so a reset database can be made usable without manual registration setup. The script should upsert a test user, set `accessStatus=active`, and optionally configure user-owned API keys for `deepseek`, `minimax`, `mineru`, and `bailian` under `USER_API_KEYS_ENABLED=1` without printing raw keys. DONE — see `scripts/seed-dev-access.ts`.
- A normal chapter summary remains regular RAG and does not activate a Skill automatically.
- A paper reading request activates `paper-reader`; missing paper input enters `awaiting_context`.
- A syllabus or exam-point request activates `exam-extract`.
- A review schedule request activates `exam-coach`.
- A code repository request activates `code-reader`.
- A stuck-learning request activates `socratic-tutor`.
- User manual Skill selection or off preference always outranks Router output. DONE.
- Router can enable web access automatically when the task clearly requires public external information, but the UI must show that web access is active. DONE.

## Remaining Runtime Hardening

- Expand `shadow` from side-effect-free planning comparison to full candidate-output/latency comparison only after provider cost and tool side effects can be safely isolated.
- Move more prompt/RAG/compression assembly behind focused context interfaces as the Runtime continues to shrink.
- Monitor long-running Worker behavior, event retention, approval recovery, error rate and per-run cost now that the production rollout is enabled; retain the configuration rollback path until those operational baselines are established.

## Multimodal Document Parsing Pipeline — Complete

Design: `docs/superpowers/specs/2026-07-06-multimodal-document-pipeline-design.md`

Status: Iteration 0-2 MVP is complete. The document pipeline now supports text, PDF (MiniMax M3), Office/WPS/iWork (MinerU), and standalone image files, with image filtering/dedup, vision analysis, and Markdown rendering.

### Iteration 0-2 MVP (complete)

- [x] Update `docs/LumenLabDocs/guides/files-and-rag.md` to reflect Office/PPT/Word support via MinerU.
- [x] Add `src/lib/document-pipeline/types.ts` with `DocumentBlock` union and `DocumentParser` interface.
- [x] Add `src/lib/document-pipeline/pipeline.ts` orchestrator and `src/lib/document-pipeline/renderer.ts`.
- [x] Add `TextLocalParser`, `MinerUParser`, `MiniMaxPdfParser` in `src/lib/document-pipeline/parsers/`.
- [x] Extend MiniMax vision in `src/lib/document-pipeline/vision/minimax-analyzer.ts` with URL/base64, detail, thinking adaptive, mode, and usage tracking.
- [x] Add `src/lib/document-pipeline/image-filter.ts` for dedup, size, and heuristic filtering.
- [x] Refactor `src/lib/files/parse-job.ts` to use `DocumentPipeline`, preserving `parseFileAsset()` signature.
- [x] Wire Office/PPT/Word image re-parsing into the MinerU flow and write vision results back to Markdown.
- [x] Add metadata fields: `parser`, `pipelineVersion`, `sourceKind`, `requiresVisionModel`, `assetCount`, `parseStartedAt`, `parseCompletedAt`, `parseWarnings`.
- [x] Add tests: `parse-job.test.ts`, `mineru-parser.test.ts`, `image-filter.test.ts`, `minimax-analyzer.test.ts`, `renderer.test.ts`.
- [x] Update `REPOSITORY_INDEX.md` with new module layout.

### Deferred Iterations

- [ ] Iteration 3: PDF hybrid parsing strategy (`chooseDocumentParsingStrategy`).
  - **Status: skipped.** Previous practice showed text/scanned classification heuristics unreliable for this project. PDF parsing will remain on the existing MiniMax-M3 document path until a better signal is available.
- [x] Iteration 4: Persistent `FileParseJob` table and recoverable queue. Done — see `prisma/schema.prisma` `FileParseJob`, `src/lib/document-pipeline/job-runner.ts`, and `src/lib/files/parse-job.ts`.
- [x] Iteration 5: Dedicated image chunks with `sourceType` metadata and **multimodal embedding** (project already uses `qwen3-vl-embedding` with image+text fusion). Done — see `src/lib/document-pipeline/chunk-builder.ts` and `src/lib/rag/vector-store.ts`.
- [x] Iteration 6: Agent roles and quality checker. Done — see `src/lib/document-pipeline/quality-checker.ts` and `src/lib/document-pipeline/pipeline.ts`.
- [ ] Iteration 7: UI parsing-mode controls and per-file quality reports.
  - **Status: will not do.** User explicitly excluded UI controls from this phase.

## Deep Research + Paper — staged implementation plan (2026-08-24)

This is an additive extension of LumenLab. The existing `AgentRuntime`, `AgentLoop`, `AgentExecution` lease/checkpoint/event replay system, Tool Registry/Policy/Audit, Project/RAG, Artifact, file parsing and object storage remain the execution and safety seams. Do not introduce a second queue or a Python/LangGraph runtime.

### Phase 0 — contracts, boundaries and migration (complete for this slice)

- [x] Read and reconcile the repository instructions, product/design system, current Prisma schema, runtime, durable worker, tool/skill registries, Project/RAG, file pipeline, object storage, SSE replay and academic Skills.
- [x] Add additive Research and Paper Prisma models with immutable Research evidence/report snapshots, Paper document versions/patches, template bindings, imports, compilations and Research-to-Paper material links.
- [x] Add a small ADR and extend `CONTEXT.md` with the Research/Paper domain vocabulary.
- [x] Review the generated migration against the local validation database and run `prisma migrate deploy`. This is local validation only; no production deployment was performed.

### Phase 1 — Research Domain primitives

- [x] Define public Research contracts: lifecycle states, plan snapshot, question/task DAG, directive impact, budget profile, role model routing, public event payloads and user-facing quality labels.
- [x] Implement pure transition guards, Quick/Deep/Comprehensive budget limits, stop-condition evaluation and source identity normalization (DOI, arXiv ID, PMID, canonical URL and project/uploaded file identity).
- [x] Build Source Provider adapters over existing audited tools: web search/fetch, arXiv, Project RAG/files, plus isolated OpenAlex, Crossref, Semantic Scholar and PubMed adapters.
- [x] Enforce the source lifecycle: search results are `SourceCandidate`; only successful fetch/full read/project-file read may create `SourceSnapshot` and `Evidence`. Store retrieved timestamp, content hash, version and object-storage location.
- [x] Implement append-only Evidence revisions, Claim/Evidence relations, source/evidence quality dimensions, conflict detection and domain profile policy seams.
- [x] Add the first executable Domain Profile catalog (`general`, `computer_science`, `medicine`, `law`) and thread source priorities, evidence/citation rules, output structure and provider preference through plan generation, stage prompts, candidate ranking and the Research UI.

### Phase 2 — durable Research Orchestrator

- [x] Extend the existing durable Agent handler seam with a Research execution kind. A Research Run may reference one `AgentExecution` and its checkpoint/events; it must not create another worker/lease framework.
- [x] Implement `Planner → bounded parallel Researchers → Evaluator → Replan → Synthesizer → Citation Verifier` as resumable stages. V1 caps Researcher fan-out at four and checkpoints after each stage/task batch.
- [x] Run the initial Planner through the existing Runtime as a durable `planning` checkpoint, persist a new immutable Plan Version when its bounded structured revision changes the deterministic draft, then pause in `awaiting_confirmation` until the user confirms.
- [x] Add plan confirmation/revision, normal directives, scope/budget expansion confirmation, per-question bounded retries and follow-up Runs. Old Plan/Run/Report snapshots remain immutable.
- [x] Add Claim Consolidation, Evidence Packs, structured `ResearchReportDocument`, citation map and local verification/repair. Synthesizer may consume only current-run Claim/Evidence/SourceSnapshot records.
- [x] Close the verification repair loop: failed/controversial Claims are deduplicated by Question into bounded follow-up Research Tasks, Worker instructions are preserved, and the existing model stage can perform a local qualification repair before the immutable Report Snapshot is frozen.
- [x] Add owner-scoped APIs and durable replay for workspace/run/plan/directive/report; continue to hide model hidden reasoning and only expose public execution events.

### Phase 3 — Research UI and navigation

- [x] Add first-level `深度研究` navigation and an API-backed workspace list showing recent Runs and status.
- [x] Implement planning/awaiting-confirmation, plan revision, run progress, directive, budget and report views. Show current task, query, source/evidence counts, question completion and verification/conflict state; never render hidden chain-of-thought.
- [x] Allow a Research Workspace to be independent or associated with a Project, and connect selected Source/Claim/Evidence/Report materials to a Paper Workspace.
- [x] Make immutable report citations actionable: Synthesizer evidence markers are persisted with a deterministic `evidenceRefs` order, known markers open the current Run's right-side Source/Evidence panel, and the panel exposes source identity, excerpt, locator, status and Claim relation without exposing hidden reasoning.
- [x] Show persisted/live budget counters and keep the public Research Run DTO explicit: checkpoint, raw provenance and internal task error payloads are not returned by the user-facing Run endpoint.

### Phase 4 — Paper document foundation

- [x] Implement the stable Academic Document Schema: metadata, abstract, keywords, heading tree, paragraph, figure, table, equation, list, quote, bibliography, appendix, acknowledgement, page break, raw LaTeX and inline marks/citation/cross-reference/footnote.
- [x] Implement append-only `DocumentVersion`, AI `DocumentPatch` accept/reject and deterministic serialization. The Document is the source of truth; generated LaTeX is a Template Adapter output only.
- [x] Add a real Paper Document Assistant through the existing Agent Runtime. It creates a strict, pending `DocumentPatch`, never applies AI output directly, and reuses the same shared schema validation as the user Patch API; the right rail keeps PDF as the default mode with an explicit AI Assistant toggle.
- [x] Add deterministic structured block operations for the Document editor: insert paragraph/heading/quote/equation/list, delete non-metadata blocks, `/` command selection and whole-heading-subtree movement; all operations preserve the existing Academic Document schema before save.
- [x] Add Paper Workspace APIs and UI: overview, Writing (outline + continuous editor + PDF/AI side panel), materials/references and typesetting settings. Use local `iconoir-react` and current shell/design rules.
- [x] Make `/papers/typesetting` a real no-AI entry point: create a blank Paper Workspace with an optional Project binding, continue existing papers, browse the live Template Library and clearly expose the compile/export path.
- [x] Organize each Paper Workspace into clear Overview, Writing, Materials & References and Typesetting Settings sections while keeping one Document source of truth and the existing compile/persistence APIs.
- [x] Add a real Paper Workspace Template Binding panel. Users can search the live Registry, select only materialized executable LaTeX/Overleaf Variants, lock the audited snapshot id/commit and create a new Binding Version without changing the structured Document; the service rejects Word/Markdown/Typst or unmaterialized bindings.
- [x] Keep Paper References separate from Research Evidence. Support manual references, DOI/BibTeX import and Research material transfer.

### Phase 5 — import, Template Registry and compilation

- [x] Add deterministic import pipeline: DOCX/OpenXML first, then Markdown AST, TXT and LaTeX. Preserve Original Source, Import Snapshot, Import Report and generated Document Version; low-confidence blocks remain visible for later AI classification and user confirmation.
- [x] Copy a curated `resources/cn-thesis-templates/` source corpus into the project and ingest its `templates.json` plus school README/raw metadata through a repeatable script, never a hardcoded university list. The current machine-readable file contains 738 records while `INDEX.md` states 671; the discrepancy remains surfaced for later reconciliation rather than silently dropping rows.
- [x] Model Template Manifest metadata, pinned upstream snapshot identity, Adapter, Validation and Sample. Keep recommendation A/B/C/D separate from runtime `Verified/Compatible/Needs Review/Deprecated/Unverified`; Word-only records remain visible without inventing LaTeX implementations. Materialized upstream files remain gated on the isolated compiler service.
- [x] Add a general Academic Template, registry search/filter and deterministic sample/conformance checker. Lock each Paper to a Template Binding Version. The Template Library now reads the complete machine-readable registry within the API limit, filters by format/maintenance/recommendation level, shows source and advanced manifest metadata, separates runtime validation from recommendation status and links persisted Sample PDFs when available.
- [x] Add a repeatable pinned-upstream materializer that reads the real registry metadata, resolves an audited Git commit without depending on the GitHub API rate limit, normalizes a deterministic `normalized-v2` zip snapshot, stores it through the existing object-storage adapter and locks the snapshot into the Template Variant. The current database evidence contains 182 materialized variants (164 LaTeX/Overleaf and 18 Typst); no upstream repository is vendored into Git. The materializer now also follows supported Overleaf, CTAN and Typst source pages when they expose a specific GitHub repository, and normalizes versioned public Typst tar.gz packages, preserving the original registry URL as provenance.
- [x] Add a real sample/conformance validator that reads pinned snapshots, builds missing `.cls` files from pinned `.ins/.dtx` sources in the ephemeral workspace, enforces `--no-shell-escape`/`-norc`, emits PDF evidence and records `Verified` or `Needs Review` with normalized errors. Successful validation now persists the PDF through the existing Object Storage adapter under a deterministic hash key; failed revalidation keeps the last successful Sample PDF reference while exposing the new error. The current local evidence covers all 164 materialized LaTeX/Overleaf variants: 33 verified PDFs and 131 Needs Review records; 18 Typst variants were explicitly skipped. Source-aware adapters now handle generic classes declared by source `.tex`, `\ProvidesExplClass`, pinned `.dtx` bootstrap for every declared output (`.cls/.def/.cbx/.bbx`), local preamble packages, comment-safe package discovery, common metadata/abstract conventions, custom degree/title argument shapes, legacy `../Template/` runtime references and class-declared bibliography backends/styles. The local MacTeX `biber` executable is currently invalid (returns `lipo` usage), so affected packs are classified as `BIBLIOGRAPHY_BACKEND_UNAVAILABLE` rather than as template syntax failures; HUST additionally records its external `hustvisual.sty` dependency as a missing package.
- [x] Record source materialization failures per affected Variant and retry the audited GitHub batch. Twenty-one previously failing GitHub repositories materialized 43 additional Variants; four repositories still fail `git ls-remote` and cover 8 Variants. These remain visible and retryable instead of being presented as materialized.
- [ ] Resolve the remaining 14 unmaterialized A/B records. The latest retry covered all seven unique sources behind them: three Overleaf pages still do not expose a safe, public, version-pinnable upstream repository (ShanghaiTech also failed page fetch), four GitHub repositories still fail `git ls-remote`, and one North Power record has no source URL. Keep all of these visible as failed/unmaterialized and retryable; do not copy private Overleaf project data or invent a source snapshot. C/D records remain visible and enter the validation queue.
- [x] Add the first isolated Compile Service process using the existing PaperCompilation/Artifact/Object Storage seams. It has an explicit service entrypoint, an ephemeral workspace, sanitized subprocess environment, `shell: false`, `--no-shell-escape`, latexmk/BibTeX/Biber fallback, bounded timeout, source/artifact quotas, asset/manifest source bundle, normalized node errors, PDF/source/SyncTeX upload and last-successful-PDF retention. The status API now explicitly selects the latest successful PDF/SyncTeX artifact while a newer compilation is queued, running or failed, and the Paper right rail keeps the latest job status separate from the displayed artifact.
- [x] Add production-oriented Compile Service container orchestration: non-root/read-only/tmpfs/capability/PID/CPU/memory/file limits, no published compiler port, and a fail-closed bubblewrap child namespace with `--unshare-net`; the Worker keeps only the control-plane network required by PostgreSQL/object storage.
- [ ] Validate the materialized A/B packs end to end in the isolated Linux compiler image. Local Docker 29.4.0 and the Compose security configuration are available, and `node:22-bookworm-slim` now pulls successfully; the `texlive-full` image build was intentionally canceled before completion because the host had only about 12GiB free while apt reported 3.9GB downloads and 7.4GB additional space.
- [x] Add an owner-scoped SyncTeX JSON mapping endpoint and a PDF.js right-panel viewer with continuous pages, page navigation and Outline-to-PDF node jumping; keep the raw `.synctex.gz` download for debugging/export.
- [x] Expose authenticated downloads for the successful PDF and the complete generated LaTeX Project ZIP, while retaining the last successful artifacts during queued, running or failed recompilation.
- [x] Extend DOCX import beyond plain paragraphs: preserve embedded images as Paper-owned FileAsset resources, create Figure/Table/Equation blocks, retain footnote inline nodes, and send uncertain structure through the existing Runtime-backed classifier as advisory suggestions before user confirmation.
- [x] Add an explicit, credential-gated real-provider Research integration test that exercises the existing Runtime/model-stage seam and cleans up its hidden system conversation; ordinary unit tests never call external models.

### Phase 6 — verification and release gates

- [x] Add targeted tests for plan confirmation/revision, transitions, durable resume, task retry, source dedupe/snapshot, Evidence immutability, Claim relations, budget/stop conditions, follow-up runs, immutable reports and citation verification.
- [x] Add Paper tests for schema/serialization, patches/version recovery, DOCX/Markdown/LaTeX import, references, registry ingestion/version locking, compile jobs, node-to-LaTeX rendering, error mapping and deterministic Template Conformance.
- [x] For this completed slice, ran lint, typecheck, full tests, Prisma validate/migration checks, production build and local in-app Browser smoke checks; updated this TODO, local `REPOSITORY_INDEX.md` and root `log.md`. The latest full gate is 293 test files / 1570 tests passed. The credential-gated Provider integration test is present and intentionally skipped locally because no E2E user/credentialed environment was supplied; unauthenticated Research/Paper entry pages rendered without framework overlays or console warnings, while a signed-in Paper Workspace PDF/AI interaction remains a fixture/credential-dependent check. Isolated Linux template validation remains blocked by the host disk capacity required for the `texlive-full` image, as recorded above.

#### Implementation guardrails

- Search/fetch results never become formal Evidence without a successful read and immutable SourceSnapshot.
- A Report Snapshot is immutable. Corrections, additions and continued research create a new Follow-up Run.
- Budget hard limits and semantic coverage/independence/conflict/information-gain gates jointly stop a Run; critical Questions take precedence when budget is scarce.
- Research role routing uses `research.planner`, `research.worker`, `research.evaluator`, `research.synthesizer` and `research.verifier` over the existing provider abstraction.
- Paper compilation is a real background job; AI is optional for typesetting and never owns the document source of truth.

### Current implementation status (2026-08-24)

- [x] Phase 0: additive Prisma migration, ADR, domain vocabulary and clean local `prisma migrate deploy` validation.
- [x] Phase 1 core: public contracts, lifecycle/budget/identity pure modules, existing Tool Registry-backed source provider, candidate→snapshot→evidence persistence, claim relations and quality labels.
- [x] Phase 2 core: resumable Research stage handler on the existing `AgentExecution` worker, bounded fan-out, evaluator/replan, synthesis, verification, immutable report snapshots, owner-scoped API and SSE replay.
- [x] Phase 3 core: first-level navigation, real workspace/run planning and confirmation UI, public progress events and report rendering.
- [x] Phase 4 core: Academic Document schema, version/patch APIs, Paper Workspace and continuous editor shell.
- [x] Phase 5 first slice: deterministic registry ingestion (all 738 machine-readable records), Markdown/TXT/LaTeX/DOCX import with original/snapshot/report/version persistence, asset-aware ephemeral compile worker with `--no-shell-escape`, PDF/source upload, references and deterministic conformance checker.
- [ ] Remaining before declaring the full roadmap complete: retry the remaining 14 unmaterialized A/B records and continue improving reviewed template packs, validate the materialized A/B packs inside the isolated Linux compiler image, and execute/record credentialed real-provider end-to-end validation/repair coverage for all model-backed Research stages.
- [x] Research role model routing and token/credit accounting now use the existing provider catalog, durable checkpoint, `calculateCredits` weights and public budget events. Planner, Worker, Evaluator, Synthesizer and Verifier now call the existing Runtime through structured-output seams with deterministic fallback; real-provider end-to-end validation remains a release-gate item.
