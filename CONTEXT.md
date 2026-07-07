# Context Glossary

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
