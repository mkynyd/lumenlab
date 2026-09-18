#!/usr/bin/env node
/**
 * check-design-tokens.mjs — static guard against undefined --color-* tokens.
 *
 * Production UI audits found tokens being referenced (var(--color-*) in
 * arbitrary values and Tailwind semantic color classes) that were never
 * defined in the design system, which silently renders as transparent/black.
 * This script fails CI/lint when that drifts again.
 *
 * What it scans under src/ (tsx/ts/css, excluding generated and test files):
 *   1. Every `--color-*` token string: var(--color-x), bg-[var(--color-x)],
 *      CSS custom property references, etc.
 *   2. Tailwind semantic color utilities: bg-error, text-text-tertiary,
 *      border-border-light, dark:bg-panel, from-accent, ... (opacity
 *      modifiers like bg-error/50 are stripped before the lookup).
 *
 * A utility suffix that is a known non-color value (text-xs, border-t,
 * via-red-500 from the built-in palette, ...) is ignored; anything else that
 * does not match a token defined in src/app/globals.css is reported.
 *
 * Usage:
 *   node scripts/check-design-tokens.mjs          scan, exit 1 on drift
 *   node scripts/check-design-tokens.mjs --self-test  run the fixture self-test
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GLOBALS_CSS = path.join(ROOT, "src", "app", "globals.css");
const SCAN_EXTENSIONS = new Set([".tsx", ".ts", ".css"]);

// Generated registry sources (ReactBits runtime components) and tests are
// out of scope: tests legitimately mention token names in assertions.
const EXCLUDE_PATTERNS = [
  /(^|[/\\])react-bits[/\\]/,
  /\.(test|spec)\.[^.]+$/,
];

// Tailwind color-utility prefixes whose suffix maps to a --color-* token.
const COLOR_PREFIXES =
  "bg|text|border|fill|stroke|ring|from|to|via|divide|outline|placeholder|caret|decoration|accent";

// Known non-color utility values (font sizes, positions, line styles, SVG
// attribute names that follow a color-ish prefix, CSS property names, ...).
const NON_COLOR_VALUES = new Set([
  // sizes / lengths / positions
  "xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl",
  "base", "left", "right", "center", "justify", "start", "end", "top", "bottom", "middle",
  "full", "screen", "auto", "min", "max", "fit", "prose", "wrap", "nowrap", "balance",
  "pretty", "clip", "ellipsis", "truncate", "sub", "super", "baseline", "text",
  // font / text styles
  "uppercase", "lowercase", "capitalize", "normal", "italic", "oblique", "bold",
  "semibold", "extrabold", "medium", "light", "extralight", "underline", "overline",
  "line-through", "no-underline", "serif", "sans", "mono",
  // keywords
  "inherit", "initial", "unset", "revert", "none", "transparent", "current", "hidden",
  "visible", "scroll", "local", "fixed", "contain", "cover", "repeat", "repeat-x",
  "repeat-y", "round", "space", "inner", "solid", "dashed", "dotted", "double",
  "groove", "ridge", "inset", "outset", "collapse", "separate", "thick", "thin",
  "x", "y", "t", "r", "b", "l", "offset", "inset-ring", "black", "white",
  // CSS property names / SVG attributes that follow a color-ish prefix
  "color", "decoration", "radius", "spacing", "align", "fill", "width", "opacity",
  "linecap", "linejoin", "dasharray", "dashoffset", "miterlimit", "anchor",
  // prose words that appear inside comments/strings and are never token names
  "only", "mode", "equivalent", "outer-tspan", "wavy", "from-font",
]);

// Built-in Tailwind palette shades (bg-red-500, via-slate-800, ...) stay valid
// even though they are not design tokens.
const BUILTIN_PALETTE_SHADE = /^(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|warm|cool)-(?:50|[1-9]00|[1-9]50)$/;

// Border sides with an explicit width (border-t-0, border-x-0, ...) are not colors.
const SIDE_WIDTH = /^[xytblr]-\d+$/;

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, files);
    } else if (SCAN_EXTENSIONS.has(path.extname(entry))) {
      files.push(full);
    }
  }
  return files;
}

function collectDefinedTokens() {
  const css = readFileSync(GLOBALS_CSS, "utf8");
  const defined = new Set();
  for (const match of css.matchAll(/--color-([a-z0-9-]+)\s*:/g)) {
    defined.add(match[1]);
  }
  return defined;
}

function collectReferencedTokens(source, isCss) {
  // token -> Set<"class" | "raw">
  const referenced = new Map();
  const add = (token, kind) => {
    if (!referenced.has(token)) referenced.set(token, new Set());
    referenced.get(token).add(kind);
  };

  // In CSS only @apply arguments are utilities; everything else is a property
  // name, keyframe name or comment prose that merely looks like a utility.
  let classSource = source;
  if (isCss) {
    classSource = [...source.matchAll(/@apply\s+([^;]+);/g)].map((m) => m[1]).join("\n");
  } else {
    // Strip comments; prose like "accent-soft convention" or "text-mode" is
    // not a utility reference.
    classSource = source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  }
  // Compound sub-utilities and gradients whose suffixes are not colors.
  const stripped = classSource
    .replace(/(?:ring|outline)-offset(?:-[a-z0-9]+)+/g, " ")
    .replace(/divide-[xy](?:-[a-z0-9]+)+/g, " ")
    .replace(/bg-clip(?:-[a-z]+)+/g, " ")
    .replace(/(?:bg-)?gradient-to-[a-z]+/g, " ");

  const classPattern = /(?<=^|[\s"'`{>:,(])(?:COLOR_PREFIXES)-([a-z][a-z0-9]*(?:-[a-z0-9]+)*)(?:\/[\d.]+)?(?=[\s"'`});:,]|$)/g
    .source
    .replace("COLOR_PREFIXES", COLOR_PREFIXES);
  for (const match of stripped.matchAll(new RegExp(classPattern, "g"))) {
    const suffix = match[1];
    if (NON_COLOR_VALUES.has(suffix) || SIDE_WIDTH.test(suffix) || BUILTIN_PALETTE_SHADE.test(suffix)) continue;
    add(suffix, "class");
  }

  // Raw token strings: var(--color-x), arbitrary values, CSS refs, comments.
  for (const match of source.matchAll(/--color-([a-z0-9-]+)/g)) {
    add(match[1], "raw");
  }
  return referenced;
}

function run(scanRoots, { label } = {}) {
  const defined = collectDefinedTokens();
  const findings = new Map(); // token -> Set<context>
  let filesScanned = 0;

  for (const root of scanRoots) {
    for (const file of walk(root)) {
      const relative = path.relative(ROOT, file);
      if (EXCLUDE_PATTERNS.some((pattern) => pattern.test(relative))) continue;
      filesScanned += 1;
      const source = readFileSync(file, "utf8");
      const isCss = file.endsWith(".css");
      const referenced = collectReferencedTokens(source, isCss);
      for (const [token, kinds] of referenced) {
        if (defined.has(token)) continue;
        if (!findings.has(token)) findings.set(token, new Set());
        for (const kind of kinds) {
          findings.get(token).add(`${relative} (${kind === "raw" ? "var/ref" : "class"})`);
        }
      }
    }
  }

  const output = { label, definedCount: defined.size, filesScanned, findings };
  return output;
}

function report(result) {
  console.log(`design tokens: ${result.definedCount} defined, ${result.filesScanned} files scanned`);
  if (result.findings.size === 0) {
    console.log("OK: every referenced --color-* token is defined in src/app/globals.css");
    return 0;
  }
  console.error(`FAIL: ${result.findings.size} referenced token(s) are not defined:`);
  for (const [token, places] of [...result.findings.entries()].sort()) {
    console.error(`  --color-${token}`);
    for (const place of [...places].sort()) console.error(`      ${place}`);
  }
  console.error("Define the token in src/app/globals.css or fix the reference.");
  return 1;
}

function selfTest() {
  const cases = [
    {
      name: "flags undefined var reference and classes",
      files: {
        "good.tsx": `export const a = "bg-[var(--color-error)] text-primary border-border-light";`,
        "bad.tsx": `export const b = "bg-[var(--color-nope)] text-wat divide-x via-red-500 text-xs";`,
        "bad.css": `.x { @apply border-nope; color: var(--color-alsogone); }`,
        // Known non-color shapes that must NOT be flagged:
        "shapes.tsx": `// accent-soft convention, text-mode toggle, text-only fallback
export const c = "border-b-0 border-x-0 text-anchor bg-gradient-to-b sm:border-t-0";
export const d = '<svg stroke-width="2" stroke-linecap="round" fill-opacity="0.5" text-anchor="middle" />';`,
        "shapes.css": `.x { border-color: red; text-align: left; border-radius: 4px; background-color: white; }`,
      },
      expectUndefined: ["nope", "wat", "alsogone"],
    },
    {
      name: "clean sources pass",
      files: {
        "clean.tsx": `export const c = "bg-danger text-text-tertiary dark:bg-panel bg-danger-muted";`,
      },
      expectUndefined: [],
    },
  ];
  let failed = false;
  for (const testCase of cases) {
    const dir = mkdtempSync(path.join(os.tmpdir(), "design-tokens-"));
    for (const [name, content] of Object.entries(testCase.files)) {
      writeFileSync(path.join(dir, name), content);
    }
    const result = run([dir], { label: testCase.name });
    const found = [...result.findings.keys()].sort();
    const expected = [...testCase.expectUndefined].sort();
    const ok = JSON.stringify(found) === JSON.stringify(expected);
    if (!ok) failed = true;
    console.log(`${ok ? "PASS" : "FAIL"} self-test: ${testCase.name} (found: ${found.join(", ") || "none"})`);
    rmSync(dir, { recursive: true, force: true });
  }
  if (failed) {
    console.error("self-test failed");
    process.exit(1);
  }
  console.log("self-test passed; fixtures cleaned up");
}

const args = process.argv.slice(2);
if (args.includes("--self-test")) {
  selfTest();
} else {
  process.exit(report(run([path.join(ROOT, "src")])));
}
