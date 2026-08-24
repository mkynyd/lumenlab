# Context Glossary

## Project

A user-owned context that groups project material, conversations, saved artifacts, and optional learning goals under one lifecycle boundary.
_Avoid_: Course, lesson container, folder

## Learning Goal

A specific learning outcome pursued with the material and activity inside one project. Any project may opt into learning goals without changing its project type; a project may retain multiple historical goals, but has at most one active learning goal in P0.
_Avoid_: Course, project type, study artifact

## Active Learning Goal

The single learning goal that currently governs a project's learning priorities and today's work. Completing, pausing, or replacing it preserves the evidence accumulated under earlier goals.
_Avoid_: Active course, current project

## Learning Scope

The confirmed topics, chapters, or assessment boundaries covered by a learning goal. A learning scope may cover all readable project material or an explicitly narrowed subset, and records material gaps instead of filling them with outside knowledge.
_Avoid_: Selected files, project description, model context

## Draft Learning Scope

A system-proposed learning scope derived from readable project material when the learner has not supplied one. It does not govern diagnostic work until the learner confirms or narrows it.
_Avoid_: Inferred syllabus, active scope

## Knowledge Map

A versioned decomposition of a confirmed learning scope into knowledge points. Regenerating a map preserves earlier versions so their learning evidence remains interpretable.
_Avoid_: Outline artifact, topic list, generated summary

## Knowledge Point

The smallest named unit whose practice and review evidence is tracked. Its stable lineage identity survives Knowledge Map regeneration when the supported concept is unchanged, while each map keeps an immutable version-specific snapshot.
_Avoid_: Document chunk, heading, quiz

## Knowledge Point Version

The immutable snapshot of a Knowledge Point inside one Knowledge Map version. Practice and evaluation evidence binds to this version; unchanged snapshots can share the same lineage identity across maps without rewriting historical evidence.
_Avoid_: Mutable knowledge point, latest topic, copied mastery state

## Mastery State

The evidence-derived learning state of a knowledge point: new, learning, or mastered. It is independent from whether review is currently due.
_Avoid_: Review status, model confidence, exam score

## Review State

The scheduling state of a knowledge point: unscheduled, scheduled, or due. A mastered knowledge point may still be due for review.
_Avoid_: Mastery state, wrong-answer status

## Learning Progress Summary

A compact, approximate view of how a learning goal's knowledge points are distributed across mastery states, with due review shown separately. It communicates direction without claiming a precise mastery probability or exam grade.
_Avoid_: Mastery percentage, predicted grade, completion score

## Content Freshness

The relationship between a learning object and the current version of its supporting project material: current, needs revalidation, or unsupported. It is independent from mastery and review state.
_Avoid_: Parse status, mastery reset, cache freshness

## Needs Revalidation

A content freshness state for a knowledge point affected by changed project material. Historical evidence remains available, but the point does not count as currently mastered until new-version evidence revalidates it.
_Avoid_: Unmastered, deleted, failed review

## Unsupported Knowledge Point

A knowledge point whose supporting project material is no longer available and has no replacement source anchor. It remains historical but cannot produce new evidence-bearing practice.
_Avoid_: Missing retrieval result, stale cache

## Source Anchor

A reference from a learning object to the specific project material location that supports it. A source anchor is evidence of origin, not the learning object itself.
_Avoid_: Citation label, selected file, retrieved context

## Practice Item

A versioned question or task used to gather evidence about one or more knowledge points. Its prompt, answer criteria, and source anchors are fixed for the lifetime of that version.
_Avoid_: Quick task, chat prompt, artifact

## Practice Item Lineage

The stable identity connecting revisions of the same logical practice item. A wording or source-anchor refresh may preserve lineage only when the assessed knowledge and answer semantics remain the same; a changed learning target or materially changed answer criteria starts a new lineage.
_Avoid_: Prompt hash, item version, automatic paraphrase group

## Evidence-Bearing Practice Item

A practice item whose evaluation is eligible to influence mastery because it can be graded deterministically or with a structured short-answer rubric.
_Avoid_: Graded chat, scored artifact, mastery result

## Feedback-Only Practice Item

A practice item that may receive instructional feedback but cannot change mastery in P0, including long-form essays, proofs, and open design work.
_Avoid_: Failed assessment, ungraded attempt

## Answer Criteria

The versioned correct answer, accepted values, or rubric used to evaluate a practice item. Answer criteria belong to the item version and are not themselves evidence of learner mastery.
_Avoid_: Model opinion, explanation, mastery threshold

## Practice Attempt

An immutable answer submitted for a specific practice item version. Repeating the work creates another attempt rather than replacing earlier evidence.
_Avoid_: Draft answer, latest answer, editable score

## Assisted Attempt

A practice attempt made after answer criteria were exposed or with instructional help. It remains learning evidence, but carries less mastery weight than an independent attempt made after meaningful spacing.
_Avoid_: Invalid attempt, failed attempt

## Assistance Level

The help context of a practice attempt: independent, hinted, or answer exposed. Together with actual spacing, it determines evidence strength under a versioned mastery policy.
_Avoid_: Difficulty, correctness, mastery state

## Evidence Strength

The relative contribution an evaluated attempt makes to mastery under a named policy version. It is derived from correctness, assistance level, and spacing rather than written directly by the model.
_Avoid_: Raw score, model confidence, permanent weight

## Spaced Redo

A new practice attempt on the same practice item after a review interval. Repeated spaced success on the same item may establish mastery without requiring a variant question.
_Avoid_: Duplicate attempt, answer replay

## Attempt Evaluation

An assessment of a practice attempt against the practice item's answer criteria. A correction or regrade creates a linked evaluation that supersedes an earlier evaluation without rewriting it.
_Avoid_: Corrected attempt, overwritten score, mastery state

## Learning Profile

A user-visible, evidence-backed projection of current learning goals, mastery, review state, weak points, and effective human corrections. It is derived only from explicit learning activity and never from casual chat or profile-prompt text.
_Avoid_: Chat memory, personality profile, hidden learner score

## Manual Learning Correction

An append-only learner statement that corrects an error type, evaluation, or learning-goal fact without rewriting the model-produced record it supersedes.
_Avoid_: Edited evaluation, overwritten history, chat feedback

## Learning Profile Reset

An explicit boundary after which earlier learning evidence no longer contributes to current profile conclusions or recommendations, while the original attempt history remains auditable. Deleting a Goal or Project remains the operation for deleting its owned learning records.
_Avoid_: Attempt deletion, mastery reset button, context-summary deletion

## Study Pack

A versioned, sectioned learning artifact assembled from a confirmed outline, current learning evidence, and project source anchors. Each section has an independent lifecycle and can be regenerated without replacing learner-edited sections.
_Avoid_: One-shot summary, chat answer, Knowledge Map

## Wrong-Answer Collection

A learning-goal view of practice items with incorrect, partial, or low-confidence attempt evidence. It is derived from the original practice and review records rather than copying questions into a second store.
_Avoid_: Question bank copy, mistake artifact, deleted failures

## Resolved Wrong Answer

A wrong-answer collection item whose later evidence satisfies the current resolution policy. It remains visible in learning history but no longer receives unresolved-item priority.
_Avoid_: Deleted wrong answer, mastered knowledge point

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

## Document Patch

An AI or user-proposed change against a Document Version that must be accepted or rejected before it changes the document. Large generated sections remain drafts until confirmation.
_Avoid_: Direct AI overwrite, compilation output

## Template Registry and Template Binding Version

The Registry is the imported catalogue of school/degree/year/format records and executable Template Packs. A Paper locks a Binding Version to a pinned upstream snapshot and Adapter so future template updates do not silently alter old papers.
_Avoid_: Latest GitHub checkout, recommendation level as runtime health
