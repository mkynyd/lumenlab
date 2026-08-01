# TODO

> Last updated: 2026-08-01

This document tracks the completed Agent Runtime consolidation plus deferred Skill, Tool, and production-hardening work.

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
