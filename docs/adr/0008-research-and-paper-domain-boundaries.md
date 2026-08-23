---
status: accepted
---

# Research and Paper are separate domains over the existing Agent execution seam

Deep Research and Paper share Project context, References, object storage and public execution events, but they have different lifecycles and sources of truth. A Research Workspace contains many durable Runs; each Run freezes its confirmed Plan and eventually creates an immutable Report Snapshot. A Paper Workspace contains exactly one structured Paper Document whose append-only versions are rendered through a locked Template Binding; Research Evidence is not automatically a Paper Reference.

Research execution references the existing `AgentExecution` lease/checkpoint/event system and uses the existing Tool Registry, Policy, approval and audit paths for source access. The Research Orchestrator owns only domain state, stage transitions, bounded fan-out and stop conditions. This keeps durable recovery in one place and prevents a second queue or hidden model-runtime contract.

This boundary is intentionally additive: the chat conversation model remains valid for existing users, while system conversations used to attach a durable execution are hidden from normal chat navigation. A report correction or additional scope creates a new Research Run, and a Paper AI edit creates a Document Patch; neither operation rewrites historical evidence or document versions.
