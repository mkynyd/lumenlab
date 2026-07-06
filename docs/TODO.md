# TODO

> Last updated: 2026-06-29

This document tracks completed first-slice Agent Orchestrator work plus deferred Skill, Tool, and follow-up action work.

## Completed First Slice

- Added the `AGENT_ORCHESTRATOR_ENABLED` feature flag. Development defaults to enabled; production defaults to disabled unless explicitly set.
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
- Added `src/lib/agent/continuation.ts` with a DeepSeek non-streaming completion loop that parses JSON action blocks, executes tools, and re-prompts until a final answer or a stop condition.
- Wired the continuation loop into `/api/chat` for DeepSeek when `AGENT_ORCHESTRATOR_ENABLED` is on.
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
- Add duplicate tool-call detection: stop when the same tool and same args repeat. DONE (framework exists and used by continuation loop).
- Add no-progress detection: stop when two consecutive rounds produce no useful new tool result. DONE (framework exists and used by continuation loop).
- Add task-profile round limits:
  - `simple`: max 2 rounds
  - `rag`: max 4 rounds
  - `research`: max 6 rounds
  - `workflow`: max 10 rounds
  DONE.
- Let the Router choose the initial task profile; let the Orchestrator adjust it at most once based on actual tool behavior. TODO.
- Add multi-round model-driven continuation. First slice uses deterministic prefetch tools before the final model response; native tool-use continuation is deferred. DONE (JSON action fallback for DeepSeek).

## Completed Stage 3 — Provider Adapters

- Moved provider-specific streaming logic out of `src/app/api/chat/route.ts` into `src/lib/agent/adapters/`.
- Added `ProviderAdapter` interface and `createProviderAdapter` factory.
- Added `DeepSeekAdapter` (wraps `streamChat`, exposes native `getToolCalls`).
- Added `MiniMaxAdapter` (wraps `streamMiniMaxChat`, currently no-op `getToolCalls`).
- `/api/chat` now selects the adapter by `modelRoute.provider` and calls `adapter.stream()` uniformly.
- Native tool calling is available through the adapter's `getToolCalls()` for DeepSeek; the legacy non-Orchestrator tool loop has been updated to use it.
- JSON action fallback is implemented in `src/lib/agent/continuation.ts` for DeepSeek when additional model-driven tool rounds are needed.
- `web.fetch` and `web.search` remain server-side product tools shared across providers.

## Model Provider Adapters

- Move provider-specific logic out of `src/app/api/chat/route.ts`. DONE.
- Add provider adapters that normalize DeepSeek and MiniMax streams into shared internal events. DONE.
- Support native tool calling where the provider supports it. DONE (DeepSeek).
- Add a JSON action fallback for models that do not support native tools reliably. DONE (DeepSeek continuation JSON actions).
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
- [ ] Iteration 4: Persistent `FileParseJob` table and recoverable queue.
- [ ] Iteration 5: Dedicated image chunks with `sourceType` metadata and image embedding.
- [ ] Iteration 6: Agent roles and quality checker.
- [ ] Iteration 7: UI parsing-mode controls and per-file quality reports.
