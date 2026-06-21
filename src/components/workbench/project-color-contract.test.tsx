import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SpotlightCard } from "@/components/workbench/spotlight-card";

describe("project workspace color contract", () => {
  it("uses the project background for the Spotlight Card base", () => {
    const { container } = render(<SpotlightCard data-testid="project-card" />);

    expect(container.firstChild).toHaveClass(
      "bg-[var(--color-project-surface)]",
      "hover:bg-[var(--color-project-surface-hover)]"
    );
  });

  it("uses the stronger neutral surface for an active Spotlight Card", () => {
    const { container } = render(<SpotlightCard active />);

    expect(container.firstChild).toHaveClass(
      "bg-[var(--color-project-surface-active)]"
    );
    expect(container.firstChild).not.toHaveClass(
      "hover:bg-[var(--color-project-surface-hover)]"
    );
  });

  it("defines blue light actions, Teal dark actions, and neutral project states", () => {
    const css = readFileSync("src/app/globals.css", "utf8");

    expect(css).toMatch(
      /:root[\s\S]*--color-project-action:\s*oklch\([^;]+257\./
    );
    expect(css).toMatch(
      /\.dark[\s\S]*--color-project-action:\s*oklch\([^;]+18[01]\./
    );
    expect(css).not.toContain("--color-project-surface: var(");
    expect(css).toMatch(
      /:root[\s\S]*--color-project-surface:\s*oklch\(0\.9[0-9]+\s+0\s+0\)/
    );
    expect(css).toMatch(
      /\.dark[\s\S]*--color-project-surface:\s*oklch\(0\.1[0-9]+\s+0\s+0\)/
    );
    expect(css).not.toContain("--color-project-hover:");
  });

  it("scopes shared primary controls to project action colors", () => {
    const css = readFileSync("src/app/globals.css", "utf8");

    expect(css).toMatch(
      /\.project-workbench\s*\{[\s\S]*?--primary:\s*var\(--color-project-action\);[\s\S]*?--primary-foreground:\s*var\(--color-project-action-contrast\);[\s\S]*?\}/
    );
  });

  it("scopes every project route root to the project workbench", () => {
    const routeSources = [
      "src/app/(chat)/projects/page.tsx",
      "src/app/(chat)/projects/new/page.tsx",
      "src/app/(chat)/projects/[id]/page.tsx",
    ];

    for (const file of routeSources) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toMatch(
        /return\s*\(\s*<div className="[^"]*\bproject-workbench\b[^"]*"/
      );
    }
  });

  it("uses restrained translucent neutral overlays in both themes", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    const light = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] || "";
    const dark = css.match(/\.dark\s*\{([\s\S]*?)\n\}/)?.[1] || "";

    expect(light).toContain(
      "--color-project-control: oklch(0.15 0 0 / 0.06);"
    );
    expect(light).toContain(
      "--color-project-surface-hover: oklch(0.15 0 0 / 0.1);"
    );
    expect(light).toContain(
      "--color-project-surface-active: oklch(0.15 0 0 / 0.15);"
    );
    expect(dark).toContain(
      "--color-project-control: oklch(0.92 0 0 / 0.08);"
    );
    expect(dark).toContain(
      "--color-project-surface-hover: oklch(0.92 0 0 / 0.13);"
    );
    expect(dark).toContain(
      "--color-project-surface-active: oklch(0.92 0 0 / 0.18);"
    );
  });

  it("avoids outline and ghost Button variants for project-neutral overrides", () => {
    const buttonSources = [
      "src/app/(chat)/projects/page.tsx",
      "src/app/(chat)/projects/new/page.tsx",
      "src/app/(chat)/projects/[id]/page.tsx",
      "src/components/project/project-sidebar.tsx",
      "src/components/project/file-upload.tsx",
      "src/components/project/file-content-dialog.tsx",
    ];
    const offenders = buttonSources.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return [...source.matchAll(/<Button\b[\s\S]*?>/g)]
        .map(([openingTag]) => openingTag)
        .filter(
          (openingTag) =>
            /variant="(?:outline|ghost)"/.test(openingTag) &&
            /color-project-(?:control|surface)/.test(openingTag)
        )
        .map(() => file);
    });

    expect(offenders).toEqual([]);
  });

  it("uses a neutral Spotlight gradient without motion transitions", () => {
    const css = readFileSync("src/app/globals.css", "utf8");

    expect(css).toMatch(
      /\.workbench-spotlight::before\s*\{[\s\S]*?radial-gradient\([\s\S]*?var\(--color-project-surface-active\)[\s\S]*?\}/
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.workbench-spotlight::before\s*\{\s*transition:\s*none;\s*\}\s*\}/
    );
  });

  it("keeps explicit project primary actions on the project action contract", () => {
    const primaryActionSources = [
      "src/app/(chat)/projects/page.tsx",
      "src/app/(chat)/projects/new/page.tsx",
      "src/components/project/project-sidebar.tsx",
      "src/components/project/file-content-dialog.tsx",
    ];

    for (const file of primaryActionSources) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toContain("bg-[var(--color-project-action)]");
      expect(source, file).toContain(
        "text-[var(--color-project-action-contrast)]"
      );
      expect(source, file).toContain(
        "hover:bg-[var(--color-project-action-hover)]"
      );
    }
  });

  it("keeps project sources free of obsolete hover and hard-coded overlays", () => {
    const projectSources = [
      "src/app/(chat)/projects/page.tsx",
      "src/app/(chat)/projects/new/page.tsx",
      "src/app/(chat)/projects/[id]/page.tsx",
      "src/components/project/project-sidebar.tsx",
      "src/components/project/file-list.tsx",
      "src/components/project/file-upload.tsx",
      "src/components/project/file-content-dialog.tsx",
      "src/components/chat/quick-task-bar.tsx",
      "src/components/workbench/spotlight-card.tsx",
    ]
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    expect(projectSources).not.toContain("color-project-hover");
    expect(projectSources).not.toMatch(/bg-(?:black|slate)-/);
    expect(projectSources).toContain("bg-[var(--color-overlay)]");
  });
});
