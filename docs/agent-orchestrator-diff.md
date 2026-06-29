# Agent Orchestrator Diff

> Date: 2026-06-29

## Summary

This iteration completes the Agent Orchestrator TODO backlog and moves chat to a provider-neutral Agent path while keeping the existing `/api/chat` entry point.

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
-> Skill Router (rule-based + manual controls)
-> Agent Orchestrator planned tools
-> provider adapter (DeepSeek / MiniMax)
-> optional model-driven continuation loop (DeepSeek)
-> Message.sources persistence
-> bottom sources UI
```

The implementation now covers manual Skill controls, follow-up action buttons, expanded provider-neutral tools, multi-round continuation via JSON action fallback, legacy RAG source migration, and provider adapters for DeepSeek and MiniMax.

## Request Flow

1. `/api/chat` parses the existing request shape, now also reading `manualSkillId` and `skillOff`.
2. `routeSkill()` classifies intent across all six built-in Skills, honoring manual selection and the persisted `skillDisabled` preference.
3. `AGENT_ORCHESTRATOR_ENABLED` decides whether the new path is active.
4. When active, legacy RAG pre-concatenation is skipped; otherwise legacy RAG sources are converted to `AgentSource` and persisted.
5. `buildPlannedToolCalls()` plans provider-neutral tools:
   - selected files -> `project_files.read`
   - project material task without selected files -> `project_rag.search`
   - explicit public URL -> `web.fetch`
   - explicit web search intent -> `web.search`
   - arXiv ID -> `arxiv.read`
   - file listing intent -> `project_files.list`
   - reference listing intent -> `reference.list`
6. `executePlannedToolCalls()` executes tools through the existing policy/audit path.
7. For DeepSeek, `runContinuationLoop()` may perform additional model-driven tool rounds via JSON action fallback.
8. A provider adapter (`DeepSeekAdapter` or `MiniMaxAdapter`) streams the final response.
9. Sources are persisted on `Message.sources` and rendered below the answer.

## Key Files

- `src/app/api/chat/route.ts`: Skill routing, feature flag, provider adapter selection, planned tool execution, continuation loop, SSE lifecycle events, source persistence.
- `src/lib/agent/skill-router.ts`: deterministic router for `paper-reader`, `paper-writer`, `exam-extract`, `exam-coach`, `code-reader`, `socratic-tutor`; supports `manualSkillId`, `skillOff`, and `skillDisabled`.
- `src/lib/agent/orchestrator.ts`: tool planning, stop conditions, injected tool execution, context construction.
- `src/lib/agent/continuation.ts`: model-driven multi-round continuation loop with JSON action fallback (DeepSeek).
- `src/lib/agent/provider-adapter.ts`: shared adapter interface and normalized stream result.
- `src/lib/agent/adapters/deepseek-adapter.ts`: DeepSeek adapter with native tool support.
- `src/lib/agent/adapters/minimax-adapter.ts`: MiniMax adapter with attachment support.
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

- `AGENT_ORCHESTRATOR_ENABLED=1`: force new path on.
- `AGENT_ORCHESTRATOR_ENABLED=0`: force legacy path off.
- unset: enabled in development/test, disabled in production.
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

Result: 76 test files, 259 tests passed. Production build completed successfully with Next.js 16.2.9.

## Remaining TODO

- Add optional DeepSeek fast JSON classifier for low-confidence routing.
- Add UI controls for manual Skill switch/off. DONE.
- Add follow-up buttons for deeper Socratic analysis, exam extraction, flashcards, and artifact save. DONE.
- Move provider-specific model calls out of `/api/chat` into dedicated adapters. DONE.
- Add native tool calling where provider support is reliable. DONE (DeepSeek).
- Add JSON action fallback for providers without native tools. DONE (DeepSeek continuation).
- Migrate legacy RAG sources into the unified bottom sources UI. DONE.
- Add deeper smoke tests with real DeepSeek and MiniMax keys after local dev access is seeded.
- Expand deferred tools (`project_files.delete`, `artifact.export_docx`, `arxiv.search`, `arxiv.fetch`, `reference.add`, `reference.attach`, `reference.format`) once approval UX hardening is complete.
- Let the Router choose the initial task profile and allow the Orchestrator to adjust it at most once based on actual tool behavior.
