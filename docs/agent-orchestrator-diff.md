# Agent Runtime Architecture Diff

> Original slice: 2026-06-29; superseded and updated: 2026-07-12

## Summary

The original Agent Orchestrator slice has now been consolidated into a provider-neutral Agent Runtime while keeping the existing `/api/chat` request and SSE contracts.

Before:

```text
/api/chat
-> legacy prompt assembly
-> optional legacy RAG context
-> DeepSeek or MiniMax stream
-> limited DeepSeek-only tool loop stub
```

After:

```text
/api/chat
-> request mapper
-> AgentRuntime.run()
   -> ContextAssembler + Skill/task planning
   -> unified AgentLoop
   -> ToolRunner + approval suspension
   -> DeepSeek or MiniMax round adapter
   -> ConversationPersistence
-> structured runtime events
-> SSE response adapter
```

The implementation covers manual Skill controls, follow-up actions, provider-neutral tools, one multi-round loop, native provider tool protocols, legacy RAG source migration, durable approval execution, and explicit rollout modes.

## Request Flow

1. `/api/chat` authenticates, rate-limits, maps the existing JSON or multipart request, calls `AgentRuntime.run()`, and adapts runtime events to the existing SSE protocol.
2. `ContextAssembler` validates project/file ownership and prepares selected-file and vision-routing context.
3. `routeSkill()` classifies intent across all six built-in Skills, honoring manual selection and the persisted `skillDisabled` preference.
4. `AGENT_RUNTIME_MODE` selects `legacy`, side-effect-free planning `shadow`, or `new` behavior. The old flag is read only when the new variable is absent.
5. `buildPlannedToolCalls()` plans provider-neutral tools:
   - selected files -> `project_files.read`
   - project material task without selected files -> `project_rag.search`
   - explicit public URL -> `web.fetch`
   - explicit web search intent -> `web.search`
   - arXiv ID -> `arxiv.read`
   - file listing intent -> `project_files.list`
   - reference listing intent -> `reference.list`
6. `AgentLoop` sends deterministic prelude and model-requested calls through the same `ToolRunner`, with allowlists, stable deduplication, no-progress detection, round limits, abort propagation, and approval suspension.
7. A provider adapter starts and continues each model round. DeepSeek owns its native names and XML/DSML fallback; MiniMax owns native tool-use/tool-result blocks.
8. `ConversationPersistence` owns conversation, message, source, and Skill-state persistence.
9. Structured runtime events are mapped to the existing SSE events and rendered in the current UI.

## Key Files

- `src/app/api/chat/route.ts`: thin HTTP boundary for auth, rate limiting, request mapping, Runtime invocation, and response adaptation.
- `src/app/api/chat/request-mapper.ts`: JSON/multipart compatibility mapping.
- `src/app/api/chat/response-stream.ts`: structured Runtime event to SSE compatibility adapter.
- `src/lib/agent/runtime.ts`: Runtime composition and end-to-end run coordination.
- `src/lib/agent/contracts.ts`: transport-independent Runtime contracts.
- `src/lib/agent/context/context-assembler.ts`: owned project/file context assembly.
- `src/lib/agent/skill-router.ts`: deterministic router for `paper-reader`, `paper-writer`, `exam-extract`, `exam-coach`, `code-reader`, `socratic-tutor`; supports `manualSkillId`, `skillOff`, and `skillDisabled`.
- `src/lib/agent/orchestrator.ts`: deterministic tool planning and approval-aware prelude construction.
- `src/lib/agent/loop/agent-loop.ts`: shared multi-round tool/model loop and stop conditions.
- `src/lib/agent/provider-adapter.ts`: round-oriented adapter contract and normalized provider events.
- `src/lib/agent/adapters/deepseek-adapter.ts`: DeepSeek native/fallback tool protocol and continuation.
- `src/lib/agent/adapters/minimax-adapter.ts`: MiniMax native tool protocol, attachments, and continuation.
- `src/lib/agent/persistence/`: conversation and tool-execution persistence ports plus Prisma adapters.
- `src/app/api/agent/approve/route.ts`: bound, single-use approval execution and terminal audit updates.
- `src/lib/agent/sources.ts`: source extraction, stable deduplication, source ordering.
- `src/lib/tools/web/fetch.ts`: public URL checks, DNS/redirect SSRF protection, HTML cleanup.
- `src/lib/rag/vector-store.ts`: legacy RAG retrieval now returns per-file sources.
- `src/components/chat/message-bubble.tsx`: bottom source rendering + follow-up action buttons.
- `src/components/chat/chat-area.tsx`: visible Skill, web access, and model adapter status badges; Skill selector state.
- `src/components/chat/skill-selector.tsx`: manual Skill switch / off control.
- `scripts/seed-dev-access.ts`: reset-db dev user and optional four-provider API key seed.

## Data Model

Added:

- `Conversation.activeSkillId`
- `Conversation.activeSkillVersion`
- `Conversation.activeSkillSource`
- `Conversation.activeSkillStatus`
- `Conversation.skillDisabled`
- `ConversationSkill.source`
- `ConversationSkill.statusAtActivation`
- `ConversationSkill.confidence`
- `ConversationSkill.reason`
- `ConversationSkill.missingInfo`
- `Message.sources`
- `Artifact.metadata`

Migrations:

```text
prisma/migrations/20260629152000_add_agent_orchestrator_state/migration.sql
prisma/migrations/20260629160000_add_skill_disabled/migration.sql
```

## Feature Flags

- `AGENT_RUNTIME_MODE=legacy`: conservative behavior and the default in every environment.
- `AGENT_RUNTIME_MODE=shadow`: run the same user response path while comparing only side-effect-free planning decisions.
- `AGENT_RUNTIME_MODE=new`: enable Runtime-owned Skill state and deterministic prelude behavior.
- `AGENT_ORCHESTRATOR_ENABLED=0/1`: deprecated compatibility mapping used only when `AGENT_RUNTIME_MODE` is absent.
- `AGENT_DEBUG_EVENTS=1`: emits debug stop-reason events.

## Sources Behavior

Assistant answers do not include inline citations. Sources render at the bottom of the assistant message.

Sources now come from:

- Agent Orchestrator path: `web.fetch`, `project_files.read`, `project_rag.search`, `web.search`, `arxiv.read`, `project_files.list`, `reference.list`, `artifact.save`.
- Legacy RAG path: project files used to build `retrievedContext` are also persisted as `project_file` sources.

Legacy non-Orchestrator RAG source migration is complete.

## Verification

Validation commands passed:

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
npx prisma validate
```

The current validation totals are recorded in the workspace `log.md` for the 2026-07-12 architecture iteration.

## Remaining TODO

- Add optional DeepSeek fast JSON classifier for low-confidence routing.
- Add UI controls for manual Skill switch/off. DONE.
- Add follow-up buttons for deeper Socratic analysis, exam extraction, flashcards, and artifact save. DONE.
- Move provider-specific model calls out of `/api/chat` into dedicated adapters. DONE.
- Add native tool calling where provider support is reliable. DONE (DeepSeek and MiniMax).
- Isolate fallback parsing inside provider adapters. DONE (DeepSeek XML/DSML fallback).
- Migrate legacy RAG sources into the unified bottom sources UI. DONE.
- Add deeper smoke tests with real DeepSeek and MiniMax keys after local dev access is seeded.
- Resume the suspended provider round automatically after an approved tool completes; today the approval is executed and audited, and the user continues with a new message.
- Expand shadowing beyond planning only when candidate provider calls and side effects can be safely isolated.
- Expand deferred tools (`project_files.delete`, `artifact.export_docx`, `arxiv.search`, `arxiv.fetch`, `reference.add`, `reference.attach`, `reference.format`) once approval UX hardening is complete.
- Let the Router choose the initial task profile and allow the Orchestrator to adjust it at most once based on actual tool behavior.
