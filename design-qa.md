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
- Primary references: `深度研究-确认方案.png` (1742 × 1662), `深度研究-进行状态2.png` (2552 × 1686), `深度研究-进行状态的右侧研究来源和状态.png` (2550 × 1684), `深度研究-完成状态.png` (2962 × 1690), `深度研究-成果详情.png` (2972 × 1678), `深度研究-成果详情界面中的侧边大纲.png` (1188 × 1360)

## Implementation evidence (2026-09-16 rework)

- Plan confirmation: `.playwright-cli/page-2026-09-16T05-06-50-835Z.png`（浅色，1600 × 1000）
- Working state with docked activity panel: `.playwright-cli/page-2026-09-16T05-03-06-712Z.png` 与局部放大 `page-2026-09-16T05-05-30-673Z.png`
- Completed report card: `.playwright-cli/page-2026-09-16T05-08-11-356Z.png`
- Full-screen reader with floating outline: `.playwright-cli/page-2026-09-16T04-44-20-363Z.png`
- All captures: real authenticated session on `localhost:3000` dev server, account `1053300241@qq.com`, light mode, 1600 × 1000.

## Comparison history

1. First pass (codex, commit `7423c3d`) kept heavy metadata surfaces: status chip rows with 来源/Evidence/Claim counters, plan metadata grid, numbered questions, inline revise input, inline activity column, and an always-expanded three-column report. User feedback: 效果不好. Reworked to follow the reference structure state by state.
2. Plan confirmation now matches 确认方案: title + dashed-circle step checklist + 计划详情 disclosure (metadata moved inside) + bottom 编辑/取消/开始研究 action row. 编辑 toggles the revise input; 取消 opens the cancel dialog.
3. Working state now matches 进行状态: single card with title + 收起活动 toggle, tri-state checklist (filled check / solid ring / dashed), footer status text + 「N 次搜索」, full-width progress bar with a square stop button (cancel) at the right end. The activity record moved from an inline grid column to a right slide-over panel (portal, z-[60], 22rem) with 研究活动 narrative, public event stream, and 研究来源 chips with 「再显示 N 个」 expansion; on xl screens the content column docks left (`xl:pr-[23rem]`) so the panel never covers the card.
4. Completed state now matches 完成状态 + 成果详情: a「研究完成情况：用时 · N 次引用 · N 次搜索」summary line, then a report card (doc icon + title + copy/expand actions) with a faded 24rem preview; 展开阅读全文 opens `research-report-reader.tsx`, a full-screen portal overlay (z-[110]) with X close, 复制报告 Markdown, floating left 目录 card (headings parsed from Markdown), centered article, and the citation-aware 来源与证据 rail. Narrow screens collapse the outline into a disclosure.
5. Stacking bug found during verification: the workbench main column's `view-enter` animation (fill mode `both`) keeps a persistent stacking context, so an inline `fixed` overlay was trapped under the z-50 sidebar. Reader and activity panel now render through `createPortal` to `document.body`.
6. Card surfaces use `--color-panel-muted` because both `--color-bg` and `--color-panel` are pure white in light mode; white cards on white pages had no visible boundary (borders are forbidden by the design language).

## Visual checks

- Typography and copy use the existing LumenLab hierarchy and terminology; internal stage jargon stays in the slim status row (stage pill / 用时 / 指挥模型).
- All state cards are borderless `--color-panel-muted` surfaces with `rounded-[var(--radius-lg)]`; states are expressed by fill and icon weight only.
- Checklist icons are pure CSS circles (filled with check / solid ring / dashed ring), no emoji, Iconoir elsewhere.
- The working state matches the reference's main-progress-card plus right-activity-panel composition without fabricating backend data.
- The completed state preserves citation hover/focus preview cards and click-to-select evidence inside the reader.

## Interaction checks

- Plan confirmation, revision (编辑 → 提交调整), and cancellation keep their existing API-backed mutations and disabled states.
- Activity panel can be closed (收起活动 / X) and reopened (研究活动); covered by the workspace component test.
- Report outline entries scroll to generated heading anchors; reader opens from both the header expand button and 展开阅读全文; Escape closes the reader. Covered by the workspace component test and verified in the browser.
- `npx tsc --noEmit` clean; `npx vitest run src/components/research/` 39/39 passed; eslint 0 errors.
- Browser console during the final captures: 0 page errors (only pre-existing notification-polling noise).

final result: passed
