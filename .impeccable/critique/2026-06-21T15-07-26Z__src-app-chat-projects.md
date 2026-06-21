---
target: project页面色彩 polish audit critique
total_score: 25
p0_count: 0
p1_count: 2
timestamp: 2026-06-21T15-07-26Z
slug: src-app-chat-projects
---
# Project Workspace Impeccable Critique

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 3 | Loading and parsing are visible; some batch completions lack durable feedback. |
| 2 | Match System / Real World | 3 | Student-facing language is clear; a few context/parsing labels remain system-oriented. |
| 3 | User Control and Freedom | 2 | Destructive actions confirm, but missing-project and error states lack strong exits or undo. |
| 4 | Consistency and Standards | 3 | Color hierarchy is coherent; project cards expose duplicate links to one destination. |
| 5 | Error Prevention | 3 | Validation and delete confirmation are solid; custom quick actions have few constraints. |
| 6 | Recognition Rather Than Recall | 2 | Primary actions are visible; many file and conversation actions depend on icons or context menus. |
| 7 | Flexibility and Efficiency | 3 | Batch selection and range selection are strong; keyboard accelerators are not discoverable. |
| 8 | Aesthetic and Minimalist Design | 3 | Restrained and focused overall; detail-page controls still compete for attention. |
| 9 | Error Recovery | 2 | Errors are readable but often offer only dismissal rather than recovery. |
| 10 | Help and Documentation | 1 | Tooltips exist, but contextual help is sparse. |
| **Total** | | **25/40** | **Acceptable** |

## Anti-Patterns Verdict

**LLM assessment:** Low AI-slop risk. The surface uses a familiar productivity-tool vocabulary, a single restrained type system, flat state changes, and no decorative card borders or shadows. The new color contract is successful: light blue and dark Teal are reserved for primary actions; inactive and secondary states are neutral; Spotlight Cards share the page background. The dot field and Spotlight treatment retain a slight generic AI-workbench association, but neither dominates the task.

**Deterministic scan:** The scoped detector returned exit code 0 with 0 findings across project routes and project components. No rules, severities, locations, or false positives were reported.

**Visual overlays:** Mutable script injection preflight succeeded, but `detect.js` failed to load in the browser despite returning HTTP 200 directly. No `impeccable` console messages were emitted, so no reliable user-visible overlay exists. Browser DOM and computed-style evidence was used instead.

## Overall Impression

The color work is cohesive and production-appropriate. The biggest remaining opportunity is interaction clarity on the project-detail page: users can see many capable tools, but first-time and mobile users must discover several of them through small icons, tooltips, and context menus.

## What's Working

- Theme semantics are explicit: light primary buttons are blue, dark primary buttons are Teal, and both meet WCAG AA contrast in the measured token pairings.
- Spotlight Cards use the exact project background token, with neutral local luminance, no visible border, and no shadow.
- Responsive structure is reliable: all three routes fit a 390px viewport without horizontal overflow; the main mobile toggle and send action are 44 by 44 pixels.

## Priority Issues

### [P1] Empty projects do not teach the first action

- **Why it matters:** A first-time user can enter an empty project and see the project name without an explicit central instruction to upload material. The upload action is an icon in the sidebar.
- **Fix:** Add a compact empty-project action in the main task area that opens the existing upload flow; remove it once files exist.
- **Suggested command:** `$impeccable onboard`

### [P1] Dense sidebar controls are undersized for touch

- **Why it matters:** File rows and toolbar controls are commonly 28-32px high; the new-conversation action is 28px. This is usable with a pointer but materially harder for one-handed or motor-impaired users.
- **Fix:** Retain desktop density, but apply 44px targets under the mobile breakpoint and preserve the current compact visual footprint through padding and icon sizing.
- **Suggested command:** `$impeccable adapt`

### [P2] Important actions depend on context menus and icon memory

- **Why it matters:** Preview, download, reparse, delete, and conversation deletion are difficult to discover on touch devices and for first-time users.
- **Fix:** Surface the most common action contextually after selection and keep destructive/rare actions in the overflow menu.
- **Suggested command:** `$impeccable clarify`

### [P2] Each project card creates duplicate navigation stops

- **Why it matters:** The title area and content area are separate links to the same route, so keyboard users visit the same project twice.
- **Fix:** Make the card use one semantic link target while keeping delete as a separate labeled action.
- **Suggested command:** `$impeccable harden`

### [P2] Errors and missing-project states lack recovery paths

- **Why it matters:** The missing-project page provides no return action, and project file messages are dismissible but not announced as a live status or paired with a retry.
- **Fix:** Add a project-space return action, use an appropriate live region for async project messages, and attach retry actions where the failed operation is safe to repeat.
- **Suggested command:** `$impeccable harden`

## Persona Red Flags

### Alex, power user

- Batch and range selection are strong.
- No discoverable keyboard shortcuts or command entry exists.
- Duplicate project-card links slow keyboard scanning.
- Bulk capability is compressed into four icons plus an overflow menu.

### Sam, accessibility-dependent user

- Most icon controls have labels and selection uses semantic checkbox/radio states.
- Several sidebar controls are 28-32px high.
- Project file messages have no `role=status` or live-region behavior.
- The project sidebar uses a labeled generic container instead of a landmark.

### Casey, distracted mobile user

- The 390px layout has no horizontal overflow, and the main toggle/send actions meet 44px.
- Sidebar tools and rows remain too small for comfortable one-handed use.
- Upload is not prominent when returning to an empty project.
- Closing the sidebar hides the concrete file selection and leaves only a count summary.

## Minor Observations

- Project-type metadata uses 10px uppercase, wide-tracked styling that contributes little in Chinese.
- Quick-task controls are 28px high and expose more than four visible choices.
- Spotlight still carries a zero-value backdrop-blur class; it is visually harmless but conceptually unnecessary.
- The only observed console error was a development-only React CSP `eval()` warning; no hydration error was observed.

## Questions to Consider

- Can a user entering an empty project know to upload material within five seconds?
- Should file selection for AI context and selection for batch operations share one state?
- Should a single project appear twice in the keyboard tab sequence?
- Should the mobile project sidebar become a touch-specific action panel rather than preserve desktop density?
