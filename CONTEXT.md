# Context Glossary

## Project

A user-owned context that groups project material, conversations, saved artifacts under one lifecycle boundary.
_Avoid_: Course, lesson container, folder

## Study Collection

A user-owned subject or exam scope containing mistake notebooks. Initialization records stage, grade, subject, major, exam and optional processed syllabus. It is independent of Project.

## Mistake Notebook

A named collection of selected questions within one Study Collection. A full uploaded paper is never automatically added to it.

## Selected Mistake

A complete user-selected question, including all options, shared material, continuation regions and illustrations. Selected crops are retained; full uploaded originals are temporary. Selection means the user wants to collect the question, without inferring a historical attempt or mastery score.

## Verified Solution

A manually checked bank answer, or a DeepSeek solution accepted only after independent Qwen solving and MiniMax checks for both correctness and complete evidence. Model verification remains fallible. Missing evidence or failed checks produce needs_review and no accepted answer.

## Temporary Import

An expiring scan preview used only to choose mistakes. Submit, cancel or expiry removes its complete preview assets; interrupted writes and deletion failures retain scoped cleanup manifests.

## Study Job

A durable owner-scoped background batch with stage, progress, bounded attempts and a fenced lease. It is separate from ordinary conversations and Project Agent executions.

## Study Task and Event

A Task records a deadline and estimated remaining work. Events record confirmed courses, planned study or busy time. Calendar planning uses explicit availability, existing events and configured holidays; it reports unscheduled work and requires preview confirmation before writing events.

## Project Material

Files uploaded into a project and parsed into model-readable content. Project material is not the same as chat history, user profile background, or saved artifacts.

## Selected Project Material

The subset of project material explicitly selected in the project file UI for the current chat request. When a prompt says "selected material", the system must interpret it as selected project files, not earlier conversation text.

## Unselected Project Material

The default state for most project quick tasks. No selected files means the system should use the readable project corpus as the candidate material, not report missing material.

## Project Corpus Coverage

For project material quick tasks, coverage means considering every currently readable project file unless the user explicitly narrows the scope. The system should not impose a small fixed file-count cap such as eight files for semester-level course material.

## Project Material Map Reduce

The fallback strategy when full project corpus content exceeds the model context window. First build compact file cards for every readable project file, then use those cards plus selected detailed snippets to answer the task. The system may compress detail, but it must not silently drop files from corpus coverage.

## Readable Mermaid Overview

A Mermaid diagram generated from project material is a readable overview, not the only carrier of full corpus coverage. When full coverage would make a single `flowchart LR` unreadable, the diagram should show the main structure and key dependencies while coverage details, file lists, and optional grouped subgraphs appear outside the diagram.

## Quick Task

A predefined project action button that sends a visible label plus a hidden task prompt. A quick task may declare its own task contract instead of inheriting the currently active Skill.

## Project Material Quick Task

A quick task whose contract requires reading or searching project material before the model answers. The server must access read-only project material for it even when the conversation currently has an unrelated active Skill; the final model generation does not need direct project material tools when deterministic prefetch has already supplied the context.

## Base Project Quick Task

A built-in quick task available in every project: extracting knowledge points, generating exam-point indexes, analyzing exam coverage, generating speed-review notes, organizing wrong-answer explanations, and generating Mermaid logic diagrams. Base project quick tasks are project material quick tasks by default.

## Personalized Project Quick Task

A quick task generated for a specific project type or project customization, such as security review, penetration testing report, interview preparation, or internship log templates. Personalized project quick tasks are also project material quick tasks by default unless explicitly declared material-free.

## Deterministic Material Prefetch

Project material quick tasks should collect project material on the server before asking the model to generate the final answer. The model should not be responsible for initiating project material tool calls for these tasks. If the model still attempts a redundant or invalid material tool call, the system should treat it as non-fatal and continue from the prefetched material context.

## Research Workspace

A long-lived, user-owned research context that may stand alone or reference a Project. It contains multiple Research Runs and durable source, snapshot, evidence and claim assets; it is not a chat conversation and is not itself a single report.
_Avoid_: Research Run, Project replacement, chat history

## Research Run

An immutable-history execution of one confirmed research question set. A Run has a Plan Version, Question/Task DAG, budget and public execution events; follow-up or correction work creates a new Run rather than rewriting the old report.
_Avoid_: Background prompt, mutable report, one-off web search

## Inherited Research Assets

When a Follow-up Run continues a completed or failed Run, active Source Snapshots, Evidence and Claims are copied into new Run-owned records with provenance pointing to their origin. The old records and report remain immutable; the copied assets begin the new Run as context and are re-evaluated there.
_Avoid_: Cross-Run mutable evidence, silently rewriting the old report, treating a prior Claim as already verified in the new Run

## Claim Reassessment

Editing a Claim marks it `user_edited` and `pending`. Reassessment reuses the current durable execution while a Run is active; after a terminal Run it creates one deduplicated Follow-up Run with inherited assets, keeps the old Report Snapshot immutable, and still passes through plan confirmation before new research runs.
_Avoid_: Rewriting a completed report, silently starting duplicate Follow-up Runs, treating edited text as verified without a new evaluator/verifier pass

## Question Attempt Budget

Every Research Question has profile-derived research, evaluation and replan attempt ceilings in addition to the Run-wide budget. Once a question reaches a ceiling, remaining tasks terminate with a public budget reason instead of retrying indefinitely.
_Avoid_: Treating a global replan count as per-question control, hot-looping retryable tasks after a question is exhausted

Evaluator quality dimensions are persisted per Question: source quality, evidence directness, independent corroboration by unique Source identity, source diversity, conflict review, coverage and recency. Stop-condition information gain is computed from new Evidence since the previous evaluation checkpoint.
_Avoid_: Counting duplicate snapshots as independent corroboration, using stale Question statuses, treating any non-empty Evidence set as ongoing information gain

## Source Candidate and Source Snapshot

A Source Candidate is a search/provider result that has not yet been read. A Source Snapshot is the successfully fetched or project-read, content-hashed version of a canonical Research Source at a particular retrieval time; only a Snapshot can produce formal Evidence.
_Avoid_: Search result as evidence, current URL as historical source

## Evidence

An append-only normalized statement with a short excerpt, exact locator, provenance, Source Snapshot and status. Corrections create a revision or superseding record; they do not rewrite the original extraction.
_Avoid_: Claim, citation string, mutable note

## Claim and Claim-Evidence Relation

A Claim is an atomic descriptive or argumentative proposition for a Run. Its relation to Evidence is explicit as supports, contradicts, qualifies or context, so conflict and qualification remain inspectable.
_Avoid_: Paragraph, unsupported summary, hidden model belief

## Research Report Snapshot

An immutable report output containing the structured document, claim/evidence/source references, citation map, coverage and verification summary, plan version, model configuration and generation time. A later user correction is a new Follow-up Run.
_Avoid_: Editable draft, Artifact replacement, live view over mutable evidence

## Paper Workspace

The long-lived document workspace for exactly one paper. It can link a Project and receive selected Research materials, but it can be created and typeset without Deep Research.
_Avoid_: Research Workspace, Project, chat artifact

## Academic Document and Document Version

The structured block document is the sole paper source of truth. A Document Version is an append-only serialized snapshot; LaTeX is generated by a locked Template Binding adapter and is never the canonical editor state.
_Avoid_: Generated `.tex`, PDF, mutable editor blob

The Paper editor edits metadata, keywords, prose, equations, figures, tables, lists and Raw LaTeX as structured blocks. A 1.2-second idle debounce saves a new Document Version and queues compilation, while import confirmation suppresses autosave until the user confirms structure.
_Avoid_: Rendering supported blocks as read-only placeholders, compiling a stale saved version, autosaving an unconfirmed import draft

## Document Patch

An AI or user-proposed change against a Document Version that must be accepted or rejected before it changes the document. Large generated sections remain drafts until confirmation.
_Avoid_: Direct AI overwrite, compilation output

## Template Registry and Template Binding Version

The Registry is the imported catalogue of school/degree/year/format records and executable Template Packs. A Paper locks a Binding Version to a pinned upstream snapshot and Adapter so future template updates do not silently alter old papers.
_Avoid_: Latest GitHub checkout, recommendation level as runtime health
