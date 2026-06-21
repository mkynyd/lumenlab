# Project Workspace Color Polish Design

## Goal

Polish the complete project workspace in light and dark themes. Project actions must use a coherent hierarchy, and project-list Spotlight Cards must use the same neutral base color as their page background.

The selected direction is **restrained single-primary-color**:

- blue is reserved for primary actions;
- secondary, hover, focus, selected, and passive status surfaces use neutral grays;
- destructive actions keep the existing semantic red treatment;
- the previous amber project-hover cue is removed from the project workspace;
- Spotlight Card depth comes from pointer-local luminance and content hierarchy, not a contrasting card fill, border, or shadow.

## Scope

The change covers every project-facing surface:

- `/projects` project list, loading state, empty state, project cards, and project actions;
- `/projects/new` form actions and states;
- `/projects/[id]` header actions and mobile sidebar trigger;
- project sidebar file, conversation, upload, classification, and overflow actions;
- project quick-task controls and project-scoped artifact access;
- project file rows, selected states, focus states, and contextual controls;
- Spotlight Card base, hover, active, and reduced-motion behavior.

The standalone `/chat`, conversion workspace, authentication pages, and global semantic error/success colors are outside the visual scope. Shared components may be reused, but project-specific color behavior must be applied through project tokens or project-scoped classes so unrelated routes do not change accidentally.

## Color Architecture

`src/app/globals.css` remains the source of truth. The project workspace will use a small semantic token set in both themes:

- `--color-project-action`: primary blue;
- `--color-project-action-hover`: accessible darker/lighter blue by theme;
- `--color-project-action-contrast`: text/icon color on the primary blue;
- `--color-project-surface`: equal to the project page background;
- `--color-project-surface-hover`: a small neutral luminance shift;
- `--color-project-surface-active`: a stronger neutral luminance shift;
- `--color-project-control`: neutral resting fill for secondary controls.

The existing amber `--color-project-hover` role will be removed or remapped to a neutral token so project interactions cannot reintroduce an amber state accidentally. Hard-coded route colors are not permitted.

## Component Behavior

### Spotlight Card

- Resting fill equals the surrounding project page background in both themes.
- The pointer spotlight uses a neutral radial luminance change with no hue shift.
- Hover and active states remain visible without creating a separate white or dark-gray slab.
- No visible border, ring, outline, or decorative shadow is added.
- Keyboard focus remains visible through the card's interactive children and a neutral background response consistent with repository rules.
- Pointer motion only updates CSS custom properties; reduced-motion users receive an immediate state change without animated movement.

### Buttons

- Primary: new project, create project, create first project, new project conversation, and the principal submit action use project blue.
- Secondary: artifact access, upload, reclassify, overflow, navigation, and non-destructive toolbar actions use neutral control fills.
- Ghost: low-priority inline controls use transparent or page-neutral resting states with a neutral hover fill.
- Destructive: delete actions retain semantic red and are never recolored blue or gray.
- Focus, active, disabled, loading, and `aria-expanded` states remain distinguishable in both themes.

### Rows and Selected States

- File rows, conversation rows, collapsible headers, and quick-task controls use neutral hover/focus fills.
- Selected rows use the stronger neutral active fill plus primary text weight; color is not the sole selection signal.
- Icons inherit the corresponding text color unless they communicate a semantic status.

## Interaction and Data Flow

No application data flow, API contract, routing, mutation, or persistence behavior changes. The implementation is limited to semantic tokens and component class composition. Existing loading, error, confirmation, and optimistic-update behavior remains intact.

## Accessibility Requirements

- Text and icon contrast must meet WCAG AA: 4.5:1 for normal text and 3:1 for large text and non-text interactive indicators.
- Primary button contrast is verified separately in light and dark themes.
- Hover is never the only interaction cue; keyboard focus and selected states remain visible.
- Mobile touch targets remain at least 44 by 44 CSS pixels where the current responsive component contract requires them.
- Theme switching must not leave stale inline colors or transition through unreadable intermediate states.

## Verification

1. Run the Impeccable detector against the project route and project UI source files.
2. Run targeted component tests, then the full test suite, lint, and production build.
3. Verify `/projects`, `/projects/new`, and one populated `/projects/[id]` route in the in-app browser.
4. For each route, verify light and dark themes at desktop and 390-pixel mobile width.
5. Exercise default, hover, keyboard focus, active, selected, expanded, disabled, loading, and destructive states where available.
6. Check browser console, hydration, and network errors.
7. Run `$impeccable audit` after implementation and then `$impeccable critique` with two independent assessments. Persist the critique snapshot.

## Acceptance Criteria

- Spotlight Cards are visibly integrated with the project-page background in both themes.
- Project buttons present one unambiguous blue primary hierarchy and neutral secondary hierarchy.
- No amber project hover remains.
- No project button or card gains a visible border, outline, ring, or decorative shadow.
- Dark mode does not turn inactive controls into heavy near-black blocks.
- Unrelated application routes retain their existing color behavior.
- Automated checks and browser verification complete without new failures.
