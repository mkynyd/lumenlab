# Project Workspace Color Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every project-facing surface a coherent light-blue/dark-Teal primary action hierarchy, neutral secondary states, and Spotlight Cards whose base color matches the project background.

**Architecture:** Keep color ownership in semantic CSS custom properties in `src/app/globals.css`. Project components consume project-scoped tokens directly so shared `/chat` controls do not inherit project-only behavior. Add contract tests around tokens and rendered component classes before changing production code.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS 4, OKLCH custom properties, Vitest, Testing Library.

---

### Task 1: Lock the Project Color Contract with Failing Tests

**Files:**
- Create: `src/components/workbench/project-color-contract.test.tsx`
- Modify: `src/components/project/file-list.test.tsx`
- Modify: `src/components/chat/quick-task-bar.test.tsx`

- [ ] **Step 1: Write the failing Spotlight and token contract test**

```tsx
import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SpotlightCard } from "@/components/workbench/spotlight-card";

describe("project workspace color contract", () => {
  it("uses the project background for the Spotlight Card base", () => {
    const { container } = render(<SpotlightCard data-testid="project-card" />);
    expect(container.firstChild).toHaveClass("bg-[var(--color-project-surface)]");
    expect(container.firstChild).toHaveClass("hover:bg-[var(--color-project-surface-hover)]");
  });

  it("defines blue light actions, Teal dark actions, and neutral project states", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toMatch(/:root[\\s\\S]*--color-project-action:\\s*oklch\\([^;]+257\\./);
    expect(css).toMatch(/\\.dark[\\s\\S]*--color-project-action:\\s*oklch\\([^;]+18[01]\\./);
    expect(css).toContain("--color-project-surface: var(--color-bg)");
    expect(css).not.toContain("--color-project-hover:");
  });
});
```

- [ ] **Step 2: Update existing interaction tests to require neutral project tokens**

Replace amber assertions in `file-list.test.tsx` and `quick-task-bar.test.tsx` with:

```tsx
expect(control).toHaveClass(
  "hover:bg-[var(--color-project-surface-hover)]",
  "hover:text-[var(--color-text-primary)]"
);
```

- [ ] **Step 3: Run the tests and verify RED**

Run:

```bash
npm test -- src/components/workbench/project-color-contract.test.tsx src/components/project/file-list.test.tsx src/components/chat/quick-task-bar.test.tsx
```

Expected: FAIL because `--color-project-surface` and `--color-project-surface-hover` do not exist, Spotlight Card still uses `--color-surface`, and components still reference `--color-project-hover`.

### Task 2: Implement Theme-Adaptive Project Tokens and Spotlight Card

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/components/workbench/spotlight-card.tsx`

- [ ] **Step 1: Add the light theme token contract**

Use the existing blue values and add neutral surface roles:

```css
--color-project-action: oklch(0.5151 0.2399 257.85);
--color-project-action-hover: oklch(0.46 0.21 257.85);
--color-project-action-contrast: oklch(0.995 0.002 255);
--color-project-surface: var(--color-bg);
--color-project-surface-hover: oklch(0.93 0 0 / 0.78);
--color-project-surface-active: oklch(0.89 0 0 / 0.82);
--color-project-control: oklch(0.94 0 0);
```

- [ ] **Step 2: Add the dark theme token contract**

Preserve the user's Teal hue while keeping readable contrast:

```css
--color-project-action: oklch(0.6492 0.1572 181.95);
--color-project-action-hover: oklch(0.72 0.14 181.95);
--color-project-action-contrast: oklch(0.13 0.02 181.95);
--color-project-surface: var(--color-bg);
--color-project-surface-hover: oklch(0.27 0 0 / 0.72);
--color-project-surface-active: oklch(0.32 0 0 / 0.78);
--color-project-control: oklch(0.245 0 0);
```

- [ ] **Step 3: Integrate Spotlight Card with the project background**

Change the base and state classes to:

```tsx
"workbench-spotlight rounded-[var(--radius-xl)] bg-[var(--color-project-surface)]",
active
  ? "bg-[var(--color-project-surface-active)]"
  : "hover:bg-[var(--color-project-surface-hover)]"
```

Update the `.workbench-spotlight::before` radial gradient to use neutral project surface tokens without a hue shift.

- [ ] **Step 4: Run the contract test**

Run:

```bash
npm test -- src/components/workbench/project-color-contract.test.tsx
```

Expected: PASS.

### Task 3: Apply the Contract Across Every Project Surface

**Files:**
- Modify: `src/app/(chat)/projects/page.tsx`
- Modify: `src/app/(chat)/projects/new/page.tsx`
- Modify: `src/app/(chat)/projects/[id]/page.tsx`
- Modify: `src/components/project/project-sidebar.tsx`
- Modify: `src/components/project/file-list.tsx`
- Modify: `src/components/project/file-upload.tsx`
- Modify: `src/components/project/file-content-dialog.tsx`
- Modify: `src/components/chat/quick-task-bar.tsx`

- [ ] **Step 1: Scope primary actions to project tokens**

Add the following classes to every project primary action without changing its behavior:

```tsx
"bg-[var(--color-project-action)] text-[var(--color-project-action-contrast)] hover:bg-[var(--color-project-action-hover)] focus-visible:bg-[var(--color-project-action-hover)]"
```

- [ ] **Step 2: Replace project secondary and ghost state colors**

Use the project-neutral contract:

```tsx
"bg-[var(--color-project-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-project-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:bg-[var(--color-project-surface-hover)]"
```

Rows use `--color-project-surface-hover`; selected rows use `--color-project-surface-active`. Preserve semantic red destructive states.

- [ ] **Step 3: Remove every obsolete project-hover reference**

Run:

```bash
rg -n "color-project-hover" src/app/globals.css 'src/app/(chat)/projects' src/components/project src/components/chat/quick-task-bar.tsx src/components/workbench/spotlight-card.tsx
```

Expected: no output.

- [ ] **Step 4: Run the project interaction tests**

Run:

```bash
npm test -- src/components/workbench/project-color-contract.test.tsx src/components/project/file-list.test.tsx src/components/chat/quick-task-bar.test.tsx
```

Expected: PASS.

### Task 4: Automated and Browser Verification

**Files:**
- Modify after completion: `../log.md`

- [ ] **Step 1: Run automated verification**

```bash
npm test
npm run lint
npm run build
```

Expected: all tests pass; lint and build exit with code 0, with only documented pre-existing warnings if any.

- [ ] **Step 2: Run Impeccable detector and technical audit**

Run the detector against project markup files, then produce the required five-dimension audit with P0-P3 findings.

- [ ] **Step 3: Verify rendered routes**

In the in-app browser, inspect `/projects`, `/projects/new`, and a populated `/projects/[id]` in light and dark themes at desktop and 390px mobile width. Verify primary, secondary, hover, focus, selected, expanded, disabled, loading, and destructive states where available; inspect console and network-visible failures.

- [ ] **Step 4: Run independent Impeccable critique assessments**

Assessment A performs the design review and Nielsen scoring. Assessment B runs the deterministic detector and browser evidence independently. Synthesize and persist the critique snapshot only after both complete.

- [ ] **Step 5: Update the workspace log**

Append a `2026-06-21` entry to `../log.md` listing all changed files, implementation summary, test/lint/build results, browser route/theme/viewport coverage, audit score, and critique snapshot path.
