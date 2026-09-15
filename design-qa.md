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
