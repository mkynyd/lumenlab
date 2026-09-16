# Global Search Design QA

## Source of truth

- Reference folder: `/Users/yinjunhang/Documents/course-ai-lab/全局搜索UI参考`
- Primary reference: `全局搜索基本UI.png`
- Supporting references: `全局搜索UI入口.png`, `全局搜索-搜索文档类别.png`, `文件预览页面.png`

## Implementation evidence

- Desktop empty state: `output/playwright/global-search/global-search-empty-compact.jpg`
- Mobile empty state: `output/playwright/global-search/global-search-empty-mobile.jpg`
- Search results: `output/playwright/global-search/global-search-desktop.jpg`
- Full comparison: `output/playwright/global-search/reference-vs-lumenlab.jpg`
- Focused comparison: `output/playwright/global-search/focused-reference-vs-lumenlab.jpg`
- Desktop verification viewport: 1440 × 900; final native viewport: 1211 × 753
- Mobile verification viewport: 390 × 844

## Comparison history

1. First implementation inherited the shared Dialog `sm:max-w-sm`, so the desktop modal rendered at 384px instead of the reference's broad search surface. Fixed with an explicit 46rem desktop width.
2. The initial empty state also inherited the result list's fixed 72vh height, creating the large vertical whitespace reported by the user. Fixed by using content height for an empty query and expanding only after typing; desktop height changed from 648px to 374px.
3. A 390px regression pass exposed the repository's early custom `sm` breakpoint: desktop geometry produced a 736px-wide modal on a phone. Geometry now switches at `md`; the final 390px modal is exactly 390px wide with no horizontal overflow.

## Visual checks

- Typography: shared LumenLab type tokens; restrained hierarchy matches the reference.
- Spacing: input, category pills, result rows, empty state, and footer form a compact vertical rhythm.
- Color: theme variables only; no reference-specific hardcoded surface colors.
- Icons: Iconoir search/chat/project/image icons plus the existing MIME-aware file icon.
- Copy: LumenLab terminology uses 对话/图片/文档/项目 and describes the actual indexed fields.
- Responsive behavior: desktop centered dialog; mobile bottom sheet; no 390px overflow.

## Interaction checks

- Sidebar entry and Command/Ctrl+K open the dialog.
- Real authenticated query `测试` returned owned conversations, documents, and a project.
- 文档 filter returned 7 matching document rows in the inspected run.
- Arrow keys and Enter are covered by component tests; a document hit navigated to the trusted `/files/[id]` preview.
- Browser console: 0 warnings, 0 errors during the final desktop/mobile runs.

final result: passed

---

# Deep Research State UI Design QA

## Source of truth

- Reference folder: `/Users/yinjunhang/Documents/course-ai-lab/深度思考UI参考`
- Product rationale: `deep-research-report.md`
- Primary references: `深度研究-确认方案.png` (1742 × 1662), `深度研究-进行状态的右侧研究来源和状态.png` (2550 × 1684), `深度研究-成果详情.png` (2972 × 1678)
- Supporting references: the remaining planning, working, completed-report, and outline screenshots in the same folder

## Implementation evidence

- Plan confirmation: `output/playwright/deep-research-ui/plan.png` (1910 × 1074)
- Working state: `output/playwright/deep-research-ui/working.png` (1910 × 1074)
- Report reader: `output/playwright/deep-research-ui/report.png` (1888 × 1062)
- Density-normalized comparisons: `compare-plan.jpg`, `compare-working.jpg`, `compare-report.jpg` in the same evidence folder; each keeps the reference above the implementation and preserves aspect ratio.
- The inspected account used dark mode. The implementation maps all surfaces, text, accents, and progress states to existing semantic theme tokens rather than reference-specific hardcoded colors, so the same hierarchy is preserved in light mode.

## Comparison history

1. The first working-state capture had insufficient separation between the progress surface and the page in dark mode. The state cards and activity drawer were moved to `--color-panel-muted`, then all three states were recaptured.
2. The original workspace exposed run history, event diagnostics, plan metadata, and result content as similarly weighted blocks. The final layout keeps those capabilities but establishes one primary state surface at a time: plan, progress, or report.
3. The report originally lacked the reference's reading navigation. Markdown headings are now parsed into a sticky left outline, while source/evidence inspection remains on the right.

## Visual checks

- Typography and copy use the existing LumenLab hierarchy and terminology; internal stage jargon is kept out of the primary flow.
- Cards and controls follow the repository's borderless visual language, with restrained rounded surfaces and Iconoir icons.
- The working state matches the reference's main-progress-plus-side-activity composition without fabricating backend data.
- The completed state preserves a readable center column, a generated outline, and a dedicated evidence/source rail.
- Narrow layouts collapse the outline into a disclosure and move side content below the primary column.

## Interaction checks

- Plan confirmation and adjustment keep their existing API-backed actions and disabled states.
- Activity details can be closed and reopened; covered by the workspace component test.
- Report outline entries scroll to generated heading anchors; covered by the workspace component test and inspected in the browser.
- Browser console during the final state captures: 0 errors.

final result: passed
