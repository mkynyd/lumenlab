# course-ai-lab Repository Index

> Last updated: 2026-07-06
> Local-only agent index. This file is gitignored.

## Structure

- `src/app`: Next.js App Router pages and API route handlers. `src/app/page.tsx` is the auth-gated landing surface — logged-in users redirect to `/chat`, anonymous users get the public marketing page (`LandingSurface`).
- `src/app/(marketing)` route group is intentionally NOT used; landing lives directly under `src/app` and stays decoupled from `(auth)` and `(chat)` route groups.
- `src/app/(auth)`: login (`/login`) and registration (`/register`) pages, now sharing the `AuthShell` visual wrapper with an `AmbientField` dot-grid background and `data-dot-avoid` form card.
- `src/components/auth`: reusable authentication shell (`auth-shell.tsx`) that composes `AmbientField`, `ThemeToggle`, brand header, and card container for the `(auth)` route group.
- `src/components/landing`: anonymous marketing surface (separate from authenticated workbench). Includes `landing-surface` (root), `landing-nav` (sticky top nav, no auth), `hero-section` (Figtree bold h1 + AmbientField + chat-demo preview), `features-section` (3-block vertical showcase with real workbench demos), `section-reveal` (GSAP ScrollTrigger vertical scrub reveal, no pin), `how-to-section` (3-step setup), `landing-footer` (CTA + RotatingText + brand tail), `scroll-reveal` (motion `useInView` fade+rise with reduced-motion guard via `useSyncExternalStore`), `prefers-motion` (media-query hook). Subfolder `demos/` contains `chat-demo`, `project-demo`, `conversion-demo`, and `project-create-demo` — pure mock-data widgets that reuse `MarkdownContent`, `ModelSelector`, `SpotlightCard`, `FileText`, `ChatLines` etc. without touching the real `/chat` or `/tools` data layer.
- `src/app/robots.ts`: private-product crawler policy; emits `/robots.txt` with all routes disallowed.
- `src/app/api/chat/route.ts`: DeepSeek/MiniMax SSE chat API with multipart attachments, project context, quick-task hidden prompts, model/thinking persistence, explicit MiniMax M3 selection, modelLock routing, rate limiting, provider access checks, Agent Orchestrator feature flag (`AGENT_ORCHESTRATOR_ENABLED`), Skill Router activation, provider-neutral planned tool prefetch, optional continuation loop flag (`AGENT_CONTINUATION_ENABLED=1`), top-level JSON error fallback, and Agent event tapping into the SSE output.
- `src/app/api/agent/approve/route.ts` + `src/app/api/agent/reject/route.ts`: Server-side endpoints for one-time approval token redemption and explicit rejection of pending `ToolExecution` rows.
- `src/app/api/projects/**`: project CRUD, file upload/listing, batch file operations, artifacts, quick action APIs, and the `vector-library` graph endpoint that returns files, chunks, and derived topic nodes.
- `src/app/api/tools/**`: authenticated PDF-to-Markdown SSE conversion, conversion image delivery, cached complete-package download, record CRUD, and save-to-project APIs.
- `src/app/api/user/profile/route.ts`: authenticated account profile endpoint for reading/updating display nickname and returning the current account avatar URL used by the settings Dialog and sidebar account menu.
- `src/app/api/user/profile/avatar/route.ts`: authenticated account avatar endpoint; uploads JPG/PNG/WebP avatars up to 20MB through the local/Qiniu object storage adapter, stores the object reference on `User`, deletes the previous avatar object after replacement, redirects Qiniu reads to the private signed `-avatar.jpg` multimedia style URL, and streams local development avatars as a fallback.
- `src/app/api/files/**`: file detail/edit/delete, signed original-file download, parse/retry, enhancement, and stale parsing cleanup.
- `src/app/(chat)/tools/**`: PDF conversion upload workspace and persisted conversion detail pages.
- `src/components/chat`: attachment-capable chat input, KaTeX/Mermaid/highlight Markdown rendering, model selector with "标准推理/深度推理" labels, collapsible quick task bar (2 visible + "更多" expand), document-flow message list with native scroll anchoring, chat-header Agent status badges (active Skill / web access / model adapter), bottom `sources` display for assistant answers, and the Agent-mode timeline (`agent-timeline.tsx`), tool-call / approval cards, and Skill badge.
- `src/components/project`: project sidebar with tab switching (资料/对话), file search filter, simplified toolbar (auto-recategorize removed) including a "资料图谱" button, Dialog-based file upload with a 2-step Stepper (选分类 → 上传, 单次最多 50 个文件), shadcn ScrollArea-backed categorized file list, ContextMenu file actions including preview, AlertDialog delete confirmation, and content dialog.
- `src/components/vector-library`: D3 force-directed graph panel (`vector-library-view.tsx`) opened from the project sidebar, plus a portal tooltip (`vector-tooltip.tsx`). Renders topic/file/chunk nodes with neutral hierarchy colors, keyboard-accessible SVG nodes, and a slide-in inspector for selected nodes.
- `src/components/settings/settings-panel.tsx`: reusable settings surface shared by `/settings` and the account-menu Dialog; includes Alpha access, token/cost statistics, AI profile prompt generation, appearance, account nickname editing, and account avatar upload.
- `src/components/user/avatar-mark.tsx`: shared flat avatar renderer used by account settings and the sidebar footer account trigger; shows uploaded avatar images when present and falls back to the preset mark.
- `src/components/tools`: PDF conversion client, complete Markdown conversion viewer, browser-print readiness marker, and shared project picker Dialog.
- `src/components/markdown/markdown-content.tsx`: shared GFM/KaTeX/highlight/Mermaid/image renderer used by chat, conversion, and project previews; safely parses sanitized raw HTML tables emitted by MinerU.
- `src/components/ui`: shadcn/ui radix-nova source components (`AlertDialog`, `Button`, `ButtonGroup`, `ContextMenu`, `Dialog`, `DropdownMenu`, `Select`, `Sidebar`, `ScrollArea`, `Switch`, `Textarea`, `Collapsible`, `Card`, `Badge`, `Spinner`, `Skeleton`, `Tooltip`, etc.) plus `next-themes` based theme provider/toggle utilities.
- `src/components/workbench`: React Bits-inspired interactive dot-grid ambient field, project-surface Spotlight Cards with a source-level color contract test, and shadcn Spinner-based loading indicators for AI/file/export waiting states.
- `src/lib/files`: parsing jobs, MiniMax M3 PDF/image parsing, MinerU Office/WPS/iWork parsing, and removed auto-categorization. `file-upload-policy.ts` centralizes extension/size limits shared by project uploads and chat attachments; `delete-file-asset.ts` is the reusable cleanup path for chunks, object storage, resources, and project index refresh used by both `/api/files/[id]` and `project_files.delete`.
- `src/lib/document-pipeline`: multimodal document parsing pipeline. `types.ts` defines `DocumentBlock`, `DocumentParser`, `ParseResult`, etc.; `parsers/` contains `TextLocalParser`, `MinerUParser`, `MiniMaxPdfParser`, and `ImageParser` for standalone PNG/JPEG/WebP files; `pipeline.ts` orchestrates parser selection, image filtering/dedup, MiniMax-M3 image analysis via URL, and Markdown rendering; `renderer.ts` converts blocks back to Markdown; `image-filter.ts` filters decorative/duplicate images and infers analysis mode; `vision/minimax-analyzer.ts` provides MiniMax-M3 image understanding with URL/base64 inputs, detail/thinking selection, and structured JSON extraction. This module will eventually replace the current parsing helper surface.
- `src/lib/hooks/use-user-profile.ts`: React Query hooks for the authenticated account profile endpoint.
- `src/lib/user-profile.ts`: shared avatar preset constants, fallback helpers, and account avatar URL builder.
- `src/lib/mock/landing-fixtures.ts`: static mock data for the landing page demos (chat messages with KaTeX + Python code, project files grouped by `FILE_CATEGORIES`, conversion sample with 4-stage progress, 3-step how-to commands). Self-contained; never reaches Prisma, NextAuth, or the workbench APIs.
- `src/lib/storage/object-storage.ts`: local/Qiniu object storage adapter for uploaded files, conversion images, project resources, cached packages, signed downloads, and deletion.
- `src/lib/parse/`: only kept `mineru.ts` + `mineru-result.ts` for the standalone `/tools` PDF-to-Markdown conversion flow; project file parsing now goes through `src/lib/vision/minimax.ts` only.
- `src/lib/export/browser-pdf.ts` + `conversion-package.ts`: authenticated Chromium printing and Markdown/PDF/DOCX/pics ZIP assembly.
- `src/lib/browser`: clipboard and Markdown download helpers with browser-compatible fallbacks.
- `src/lib/chat/router.ts`: text/multimodal attachment classification and model lock routing.
- `src/lib/chat/minimax-chat.ts`: MiniMax M3 streaming chat client with image/document attachment blocks.
- `src/lib/chat/project-conversation-state.ts`: project conversation message normalization, including bounded recovery of recent empty assistant placeholders.
- `src/lib/rag`: document chunks, task-driven project context strategy, Agentic file scoping, keyword/vector hybrid retrieval, project index generation, and `vector-library.ts` for building topic/file/chunk graph data from project documents.
- `src/lib/tools/knowledge/project-rag.ts`: Agent MVP project knowledge search with Chinese keyword bigram extraction for natural Chinese quick-task prompts.
- `src/lib/rag/embedding.ts`: Aliyun Bailian `qwen3-vl-embedding` 1024-dimension client and pgvector write helpers.
- `src/lib/quick-actions.ts`: default per-project-type system quick action presets.
- `src/lib/agent/`: Agent-mode core — `types.ts` (RiskLevel / ToolMetadata / SkillMetadata / ToolExecutionStatus / ToolCallPreview / PolicyDecision / AgentEvent), `tool-registry.ts` + `skill-registry.ts` (central registries), `skill-router.ts` (deterministic routing across six built-in Skills), `orchestrator.ts` (task-profile budgets, planned provider-neutral tool calls, injected tool execution, context construction), `sources.ts` (source extraction/dedup), `policy-engine.ts` (L0–L4 risk + scope + workspace + Skill allowlist + risk-ceiling + argument validation + session-pre-approval + L3/L4 ask-each enforcement), `approval-token.ts` (one-time `<tokenId>.<raw>` token with sha256 storage and argument-hash replay protection), `tool-executor.ts` (handler dispatch + `ToolExecution` row persistence), `event-stream.ts` (AgentEvent ↔ `event: agent` SSE serialization), `conversation-loop.ts` (per-tool-call agent event flow + DB writes), `preview-builder.ts` (sanitized ToolCallPreview with API-key / email redaction), `audit-log.ts` (best-effort `AgentAuditLog` writer).
- `src/lib/tools/`: Built-in tool implementations under `project-files/` (list/read/delete), `artifacts/` (save/list with Message.sources -> Artifact.metadata propagation), `web/` (search/fetch with public URL SSRF checks, DNS/redirect revalidation, 8s timeout, 1.5MB body cap, Readability/Turndown/html-to-text cleanup; `web.fetch` additionally enforces a configurable `WEB_FETCH_ALLOWLIST` domain allowlist), `knowledge/` (project RAG keyword scan), `arxiv/` (search via arXiv API XML, read single paper metadata, fetch via web.fetch), `reference/` (add/list/attach/format citation-manager), `artifact-export/` (Markdown → .docx via `docx` lib), `shared/sanitize.ts` (cross-tenant pre-checks), and `registry.ts` that wires every Tool + handler into `toolRegistry` + `tool-executor` with `L1`/`L2`/`L3` risk metadata.
- `src/lib/skills/`: Built-in Skill packages — `paper-writer/`, `exam-coach/` (v1.1.0 with exam-prep 5-step workflow), `code-reader/`, `paper-reader/` (v1.0, paper-quick-reader three-depth reading), `exam-extract/` (v1.0, exam-ready syllabus-driven extraction), `socratic-tutor/` (v1.0, academic-tutor Socratic questioning). Each has `manifest.ts` (SkillMetadata + Tool allowlist + risk ceiling + required scopes) and `instructions.ts` (full SKILL.md-derived prompt). `registry.ts` re-exports the legacy `SkillDefinition` shapes plus the new `buildToolsPayloadForProvider` helper that drops client tools for DeepSeek and emits `web_search_20250305`. `executor.ts` is now a thin compat layer that maps legacy `search_project_files` / `list_project_files` calls into the new tool executor.
- `src/lib/file-categories.ts`: shared file category constants.
- `docs/TODO.md`: Agent/Skill/Tool roadmap with completed first-slice notes and deferred provider adapter / native tool / follow-up action work.
- `docs/agent-orchestrator-diff.md`: before/after handoff document for the Agent Orchestrator iteration.
- `scripts/seed-dev-access.ts`: local reset-database helper that upserts an active dev user and optional DeepSeek/MiniMax/MinerU/Bailian user API keys without printing raw secrets.
- `prisma`: Prisma schema and migrations.

## 关键技术点

- `src/lib/document-pipeline` 实现了多模态文档解析流水线：统一 `DocumentBlock` 抽象、可插拔 `DocumentParser`、图片去重/过滤启发式、MiniMax-M3 视觉分析、MinerU Office/PDF 解析，以及将解析结果渲染回 Markdown 的 `renderer`。流水线已被 `parse-job.ts` 采用，支持文本、PDF、Office/WPS/iWork 和独立图片文件。

## Data Models

- `User`: authenticated account and owned resources, including optional display `name`, persisted fallback `avatarPreset`, uploaded avatar object metadata (`avatarStorageProvider`, `avatarObjectKey`, `avatarMimeType`, `avatarUpdatedAt`), and generated `profilePrompt`.
- `ApiKey`: legacy user API key storage.
- `CredentialProfile`, `ProviderCredential`, `RegistrationCode`, `RegistrationRedemption`, `RegistrationPublication`, `RegistrationSyncNonce`: Alpha registration and central provider access.
- `Project`: project workspace; defaults to `deepseek-v4-pro` and `thinkingEnabled = true`.
- `Conversation`: chat thread; stores model, `thinkingEnabled`, `modelLock` for MiniMax multimodal continuity, and current Agent Skill state (`activeSkillId/version/source/status`).
- `Message`: persisted user/assistant/system messages, token usage, the actual provider that produced each assistant response, and bottom-rendered Agent `sources`.
- `FileAsset`: uploaded file metadata, storage provider/path, parse status, text content, enhancement state, category, category confidence, and copied Markdown resources.
- `FileAssetResource`: project-owned image resource copied from a document conversion.
- `ProjectIndex`: per-project `INDEX.md` content used for file matching.
- `QuickAction`: system/custom project quick action button definitions.
- `Artifact`: saved Markdown artifacts, export sources, and optional `metadata` such as sources copied from the originating assistant message.
- `DocumentChunk`: parsed text chunks for keyword and Bailian 1024-dimension vector retrieval.
- `DocumentConversion`: user-owned PDF-to-Markdown result, source metadata, page count, MinerU metadata, image relation, and cached complete-package reference.
- `DocumentConversionAsset`: private referenced image with normalized `pics/` path and local/Qiniu object reference.
- `SkillPackage`: declarative Skill bundle (`skillId` + `version`, allowed tools / risk ceiling / required scopes / input-output contracts / data-handling policy). Unique on `(skillId, version)`.
- `Reference`: user-owned bibliography entry (DOI / arxivId / manual fields; metadata for citation-manager).
- `ReferenceListItem`: artifact ↔ reference link with per-item `format` and optional `inlineMarker`.
- `ConversationSkill`: per-conversation Skill activation log with source, status at activation, confidence, reason, missing-info JSON, and deactivation timestamp.
- `ToolDefinition`: declared Tool bundle (risk level, side-effect flags, approval mode default, audit level, allowed Skill IDs).
- `ToolExecution`: one row per proposed / pending / executing / completed tool call. Stores normalized args, sha256 `argumentsHash`, status, approval snapshot, token hash, scope, timestamps, and result / error summaries.
- `ApprovalToken`: one-time approval token — only the sha256 of the raw secret is stored; consumer re-verifies the `argumentsHash` to block model-side argument swap attacks.
- `AgentAuditLog`: best-effort audit trail for `tool_proposed`, `tool_blocked`, `approval_required`, `approval_granted`, `tool_started`, `tool_completed`, `tool_failed`, `user_rejected`, `token_consumed` events.
- `UserToolPreference`: per-user Tool approval overrides (L3/L4 cannot be stored as `auto`).
- `LoginAttempt`: audit trail for login success/failure with `email`, `ip`, `success`, and `createdAt`.

## Current Workbench Flow

1. User creates a project; system quick actions are copied into `QuickAction`.
2. Upload API saves source files through the storage adapter, using Qiniu Kodo private object storage when configured and local `uploads/` only as a development fallback; `FileAsset.storageProvider` records `qiniu` or `local`.
3. Text files are read from the storage adapter and parse locally; PDF goes to MiniMax M3 native document parsing and images go to MiniMax M3 image parsing; Office/WPS/iWork formats go through MinerU Markdown parsing, with extracted images persisted as `FileAssetResource` rows and rewritten to private file resource URLs.
4. Parsed content updates `FileAsset`, writes INDEX summary/keywords, rebuilds `DocumentChunk`, optionally writes Bailian embeddings, and refreshes `ProjectIndex`. **No auto-categorization**: the user picks the category in the upload modal step1.
5. Project chat first decides whether the request actually needs project material. Ordinary project chat skips file loading and query embedding; material-aware requests use selected files or Agentic Retrieval only as candidate scopes, while corpus-wide quick tasks such as knowledge extraction and exam-index generation bypass Agentic narrowing when no files are selected, include every parsed/partial project file, and prepend one representative chunk per file before additional keyword/vector retrieval. Query embedding is generated lazily only for hybrid retrieval with searchable chunks.
6. Chat attachments use multipart FormData. Text attachments are appended to the prompt and stay on the user-selected provider; image/PDF/Office attachments route to MiniMax M3 and set `Conversation.modelLock = "minimax"`. Each completed assistant message persists the actual routed provider so Settings token totals can be grouped without relying on the conversation's default model.
7. MinerU Markdown that still contains image references is marked with `requiresVisionModel`; chat that uses those files routes to MiniMax M3, locks the conversation, and compresses prior DeepSeek history into a MiniMax-safe context handoff.
8. Project UI groups files by category inside a content-sized shadcn ScrollArea, supports unified selection controls, one-row compact shadcn ButtonGroup toolbars (`select/upload/recategorize/more`), Dialog-based upload, failed-file reparse, forced AI recategorization, More-menu selected-context delete/reparse/download actions, file right-click ContextMenu preview/download/reparse/delete actions with AlertDialog confirmation for deletion, project conversation ContextMenu deletion, blocks chat while files are parsing, queues messages, and sends queued messages after parsing finishes.
9. Project deletion cleans original stored objects, then explicitly removes project conversations before deleting the project so project chats do not leak into the standalone chat list.
10. The workbench UI uses modern technical-minimal styling: low-saturation OKLCH theme tokens mapped into shadcn semantic variables, `next-themes` class-based light/dark/system mode, translucent rounded panels, interactive canvas dot-grid ambient fields outside the artifact library, borderless buttons/cards, flat spotlight cards for clickable project surfaces with project-card ContextMenu actions, shallow translucent gray hover/selected states, no deep-gray hover/selected blocks, no border/ring/outline wrapper around button or card surfaces, explicit selected-file context feedback, no upward hover motion, a 0/4/8/12/16px radius token scale, Iconoir button icons in workbench actions, shadcn Sidebar primitives for navigation/project sidebars with the account menu in the Sidebar footer, account settings in a Dialog with nickname editing, uploaded avatar management, and token/cost statistics, Radix DropdownMenu combined strength/model selector with thinking always enabled, Radix Select/Switch/Textarea controls, and ordinary Spinner loading indicators without background rings.
11. Assistant streaming messages show the waiting animation only inside the assistant bubble, expose a shadcn Collapsible thinking-process panel while reasoning content is arriving, keep server-side response saving detached from project conversation switching, and recover empty persisted assistant placeholders through lightweight conversation polling.
12. Quick task buttons send a UI label as the user message and inject the full prompt as hidden model context.
13. The document tools workspace uploads one PDF at a time to an authenticated SSE route, streams MinerU progress, safely extracts every referenced image, rewrites Markdown to normalized `pics/` paths, persists private conversion assets, and renders results with the same Markdown component/CSS as chat.
14. Complete-package download is generated on demand and cached in object storage. It contains Markdown, `pics/`, an authenticated Chromium-printed PDF, and a DOCX with embedded images. Saving to a project copies resources into `FileAssetResource`, so deleting conversion history does not break project previews.

## Commands

```bash
npm install
npx prisma generate
npx prisma migrate dev
npm test
npm run lint
npm run build
npm run dev
```

## Landing page notes

- The root `src/app/page.tsx` is the only entry point for anonymous traffic; it keeps the same `auth()` check but renders `<LandingSurface />` instead of redirecting to `/login`.
- `LandingSurface` does **not** mount `SessionProvider`/`QueryProvider` or the workbench `Sidebar`/`Navbar`. It is fully self-contained and safe for cold anonymous loads.
- Feature demos reuse real workbench components (`MarkdownContent`, `ModelSelector`, `SpotlightCard`) for visual fidelity and responsive behavior, but every prop is fed from `src/lib/mock/landing-fixtures.ts`. There is no Prisma / NextAuth / SSE in the landing tree.
- `features-section` uses a vertical MacBook-Pro-style reveal: `section-reveal` sets up GSAP ScrollTrigger `scrub` for opacity + translateY, with no horizontal pin and full `prefers-reduced-motion: reduce` bypass.
- Figtree is loaded via `next/font/local` from `fonts/Figtree/static/` (OFL 1.1) and bound to `--font-figtree`; CJK falls back to Noto Sans SC through the existing `--font-sans` stack.

## Notes

- `REPOSITORY_INDEX.md` is intentionally ignored and must not be staged.
- Docker runner installs Chromium and Noto CJK fonts for CSS-faithful Markdown PDF printing. The standalone `/tools` PDF-to-Markdown flow still uses MinerU Precision API; project file parsing has switched to MiniMax M3 (PDF + image).

## Agent mode (online workflow)

The project workspace runs as a server-mediated Agent: every `tool_use` the model emits goes through a server-side `PolicyEngine` (`src/lib/agent/policy-engine.ts`) before any side effect.

- **Agent Orchestrator first slice**: `/api/chat` now routes through `skill-router.ts` and `orchestrator.ts` when `AGENT_ORCHESTRATOR_ENABLED` is active. The first slice uses deterministic planned prefetch tools (`project_files.read`, `project_rag.search`, `web.fetch`) before the final model response, so DeepSeek and MiniMax can share the same server-side tools. Model-driven JSON action continuation is kept behind `AGENT_CONTINUATION_ENABLED=1`; native provider tool-use continuation remains TODO.
- **Sources**: Agent tool results are normalized by `src/lib/agent/sources.ts`, persisted on `Message.sources`, copied into `Artifact.metadata` when saving, and rendered at the bottom of assistant messages. Inline citation markers are intentionally not inserted into the answer body.
- **Risk levels (L0–L4)** are static on each `ToolDefinition`. MVP ships `L1` (auto) for `project_files.list/read`, `artifact.list`, `project_rag.search`, `web.search`, `web.fetch`; `L2` (auto on session pre-approve) for `artifact.save`; `L3` (always ask-each) for `project_files.delete`. L4 schema is reserved.
- **Skill allowlist**: Skills are controlled bundles (`paper-writer`, `exam-coach`, `code-reader`) that can only narrow permissions — never widen.
- **One-time approval token**: `issueApprovalToken` returns `<tokenId>.<raw>`, stores only sha256 of `raw`. `consumeApprovalToken` re-checks sha256 + `argumentsHash` so the model cannot swap parameters between `proposed` and `approved`.
- **SSE event stream**: Agent events are emitted as `event: agent` lines (parsed by `src/lib/sse-client.ts`'s extended `readSSEStream`) with types `tool_proposed / tool_blocked / approval_required / approval_granted / approval_denied / approval_expired / tool_started / tool_progress / tool_completed / tool_failed`. The chat route prepends them to the assistant delta stream.
- **Frontend timeline**: `AgentTimeline` (`src/components/chat/agent-timeline.tsx`) reduces `ApprovalState` from these events; `ApprovalCard` shows affected resources + reversibility + sample + three actions (`仅本次允许` / `本会话同类允许` for L1/L2 only / `拒绝`).
- **Rejection does not abort the task**: rejection only marks the single `ToolExecution` row; the model continues subsequent steps.
- **DeepSeek tools payload fix**: `buildToolsPayloadForProvider` filters out client tools and emits `web_search_20250305` only — eliminates the prior `400 unknown variant custom` error without changing the existing tool-execution loop guard.
- Markdown rendering uses KaTeX in lenient mode (`strict: false, throwOnError: false`) to avoid console warnings on mixed Chinese/math input without breaking the readable output.
- DeepSeek chat wrapper drops the unsupported `thinking: { type: "adaptive" }` (DeepSeek's anthropic-compat only knows `enabled`/`disabled`) and surfaces the upstream error message alongside the friendly map. The chat API passes 4xx status codes through instead of blanket-rewriting them to 502.
- Markdown rendering includes KaTeX, Mermaid, and highlight.js.
- Converted raw HTML is parsed with `rehype-raw` and filtered through `rehype-sanitize` before KaTeX/highlight transforms, preserving document tables without allowing executable markup.
- Workbench backgrounds are intentionally unified to interactive dot-matrix ambient fields; line backgrounds are not used in the student workbench.
- `iconoir-react` is used for modern workbench button icons.
- `@mozilla/readability`, `turndown`, `html-to-text`, and runtime `jsdom` are used by `web.fetch` to convert public HTML pages into model-friendly Markdown/text.
- shadcn/ui is initialized with `components.json` using radix-nova style; generated source components live under `src/components/ui`, and `npx shadcn@latest` should be used for future component additions/updates.
- Dark mode follows the shadcn/Next.js `next-themes` pattern with `attribute="class"`, `defaultTheme="system"`, `enableSystem`, and `disableTransitionOnChange`.
- Current build has a pre-existing Turbopack NFT tracing warning from artifact PDF export imports.
- Production file storage requires Qiniu Kodo private bucket configuration: `QINIU_ACCESS_KEY`, `QINIU_SECRET_KEY`, `QINIU_BUCKET`, `QINIU_REGION`, `QINIU_UPLOAD_HOST`, and `QINIU_PRIVATE_DOMAIN`; signed original-file download links expire after 10 minutes. Account avatars expect the Qiniu multimedia style `avatar.jpg` (`imageView2/0/format/jpg/q/75|imageslim`) and are displayed via `原始对象 key-avatar.jpg` with the private-space signature.
- Project uploads accept files up to 50MB each, 50 files per request, and 300MB total per request; `experimental.proxyClientMaxBodySize` is set to 400MB to preserve multipart bodies through the Next.js proxy. The standalone PDF conversion workspace still accepts one PDF at a time.

## Promotional assets

- `promo-images/`: 9 high-resolution (3000x3000, 1:1, transparent background) promotional PNGs generated via PIL/Pillow for social media. Files follow `01-brand.png` through `09-rag.png`, each illustrating a core LumenLab feature with Chinese text, UI-style cards, and Lucide-style icons.
- `generate_promo_images.py`: Python script that generates the above 9 images using the project's design system (transparent background, dot-grid ambient, #5a5fe1 accent, rounded white cards, PingFang SC / STHeiti Chinese font fallbacks).
