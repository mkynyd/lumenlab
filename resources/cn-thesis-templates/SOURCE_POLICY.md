# Template source corpus policy

This directory is a curated, versioned copy of the workspace-level
`cn-thesis-templates` collection. It is the local source corpus for the
LumenLab Template Registry; it is not a claim that every upstream repository
or template implementation is bundled here.

## Retained

- `templates.json` and `templates.yaml`: machine-readable registry metadata.
- `INDEX.md`: human-readable index and known data-quality discrepancy.
- `latex/`, `word/`, `markdown/`: school-level README/specification records.
- `_meta/EXPANSION_REPORT.md`, `_meta/gb7713_overview.md`, and
  `_meta/school_lists.md`: coverage, standards, and source context.
- `_raw/*.md`: source evidence used to audit or improve metadata.
- `skills/INDEX.md`: attribution/index only; external Skill bodies are not
  automatically registered or executed by LumenLab.

## Excluded

Batch JSON backups, collection workflow scripts, duplicate intermediate
records, external Skill bodies, `.git` metadata, build outputs, and upstream
repository working trees are intentionally excluded. The original source
directory remains outside this repository as a rollback/reference copy.

Registry metadata may point to upstream repositories or official documents.
Before bundling an actual `.cls`, `.sty`, Word template, font, or other
upstream asset into a runnable Template Pack, record its source, pinned
revision, and license in the corresponding `TemplateManifest` and verify
redistribution compatibility.
