# PDF Markdown Image Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve MinerU-referenced images, render complete Markdown previews, and export an image-complete Markdown/PDF/DOCX ZIP package.

**Architecture:** Normalize referenced MinerU ZIP images into conversion-owned assets stored through the existing local/Qiniu adapter. Reuse one Markdown renderer across chat, conversion, and project previews; generate DOCX and browser-printed PDF from persisted assets, then cache the complete ZIP in object storage.

**Tech Stack:** Next.js 16 App Router, React 19, Prisma 7/PostgreSQL, AdmZip, docx, sharp, playwright-core/Chromium, Vitest, local/Qiniu object storage.

---

## File map

- Create `src/lib/parse/mineru-result.ts`: safe ZIP path resolution, image reference normalization, and asset extraction.
- Modify `src/lib/parse/mineru.ts`: return normalized Markdown plus referenced image buffers.
- Modify `src/lib/storage/object-storage.ts`: upload server-generated conversion/resource/export object keys.
- Modify `prisma/schema.prisma` and create a migration: conversion assets, project file resources, cached export reference.
- Create `src/lib/conversions/assets.ts`: persist/read/copy/delete conversion and project resources.
- Create authenticated conversion/project asset route handlers.
- Create `src/components/markdown/markdown-content.tsx`: shared full Markdown renderer.
- Modify chat, conversion, and project preview components to use the shared renderer.
- Modify `src/lib/export/markdown-to-docx.ts`: embed image buffers.
- Create `src/lib/export/conversion-package.ts`: assemble Markdown, pictures, PDF, and DOCX ZIP.
- Create `src/lib/export/browser-pdf.ts`: authenticated Chromium printing.
- Create the complete-package route and print-ready conversion view.
- Modify Docker/package manifests and repository documentation.

### Task 1: Add resource persistence and generic object storage

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260620160000_add_conversion_assets/migration.sql`
- Modify: `src/lib/storage/object-storage.ts`
- Test: `src/lib/storage/object-storage.test.ts`

- [ ] **Step 1: Write failing storage tests**

Add tests proving nested local keys are written/read/deleted and invalid traversal keys are rejected:

```ts
const stored = await uploadObjectBuffer({
  key: "users/user-1/conversions/conversion-1/assets/asset-1/circuit.png",
  mimeType: "image/png",
  buffer: Buffer.from([1, 2, 3]),
});
expect(stored.key).toContain("conversions/conversion-1/assets");
await expect(readStoredObject(stored)).resolves.toEqual(Buffer.from([1, 2, 3]));
await expect(uploadObjectBuffer({
  key: "../escape.png",
  mimeType: "image/png",
  buffer: Buffer.from([1]),
})).rejects.toThrow("对象路径无效");
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npm test -- src/lib/storage/object-storage.test.ts`

Expected: FAIL because `uploadObjectBuffer` does not exist.

- [ ] **Step 3: Implement storage and schema primitives**

Add a server-keyed object upload API while keeping `uploadFileBuffer` backward compatible:

```ts
export async function uploadObjectBuffer(input: {
  key: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<StoredObjectRef> {
  const key = normalizeObjectKey(input.key);
  const provider = activeStorageProvider();
  if (provider === "local") {
    const target = resolveLocalPath(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, input.buffer);
    return { provider, key };
  }
  await uploadQiniuObject({ key, mimeType: input.mimeType, buffer: input.buffer });
  return { provider, key };
}
```

Add `DocumentConversionAsset` and `FileAssetResource` models with unique `(ownerId, relativePath)` indexes. Add nullable `exportStorageProvider`, `exportStoragePath`, `exportSize`, and `exportGeneratedAt` fields to `DocumentConversion`. Add cascading Prisma relations, while retaining explicit object deletion in application code.

- [ ] **Step 4: Generate Prisma client and run focused tests**

Run: `npx prisma generate && npm test -- src/lib/storage/object-storage.test.ts`

Expected: Prisma generation succeeds and storage tests PASS.

- [ ] **Step 5: Commit**

```bash
git add prisma src/lib/storage/object-storage.ts src/lib/storage/object-storage.test.ts
git commit -m "feat: add conversion resource storage models"
```

### Task 2: Normalize MinerU image assets with strict path validation

**Files:**
- Create: `src/lib/parse/mineru-result.ts`
- Create: `src/lib/parse/mineru-result.test.ts`
- Modify: `src/lib/parse/mineru.ts`
- Create: `src/lib/parse/mineru.test.ts`

- [ ] **Step 1: Write failing ZIP normalization tests**

Build an in-memory AdmZip containing `result/full.md`, nested images, duplicate basenames, an external image, and a traversal reference. Assert the successful fixture returns:

```ts
expect(result.content).toContain("![电路](pics/circuit.png)");
expect(result.content).toContain("https://example.com/external.png");
expect(result.assets).toEqual([
  expect.objectContaining({
    relativePath: "pics/circuit.png",
    mimeType: "image/png",
    buffer: expect.any(Buffer),
  }),
]);
```

Add separate fixtures asserting missing internal entries and `../../secret.png` throw `MinerUError`-compatible messages listing the invalid reference.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- src/lib/parse/mineru-result.test.ts`

Expected: FAIL because `extractMinerUResult` does not exist.

- [ ] **Step 3: Implement normalized extraction**

Define focused return types and preserve only referenced assets:

```ts
export interface ParsedImageAsset {
  relativePath: string;
  mimeType: string;
  buffer: Buffer;
}

export interface ParsedMinerUResult {
  content: string;
  assets: ParsedImageAsset[];
}

export function extractMinerUResult(zipBuffer: Buffer): ParsedMinerUResult {
  // Locate full.md, resolve internal image URLs relative to its directory,
  // reject absolute/traversal/missing paths, flatten names into pics/ with
  // stable hash suffixes, and rewrite Markdown plus HTML img references.
}
```

Update `downloadAndExtractResult` and `parseFileWithMinerU` to return `assets`, set `retainedImageCount` from the actual list, and keep the 10KB threshold only for `requiresVisionModel`, never for persistence.

- [ ] **Step 4: Run parser tests**

Run: `npm test -- src/lib/parse/mineru-result.test.ts src/lib/parse/mineru.test.ts`

Expected: all normalization, missing-image, and traversal tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/parse/mineru.ts src/lib/parse/mineru-result.ts src/lib/parse/mineru-result.test.ts src/lib/parse/mineru.test.ts
git commit -m "feat: preserve referenced MinerU images"
```

### Task 3: Persist conversion assets and expose authenticated image routes

**Files:**
- Create: `src/lib/conversions/assets.ts`
- Create: `src/lib/conversions/assets.test.ts`
- Modify: `src/app/api/tools/pdf-to-markdown/route.ts`
- Modify: `src/app/api/tools/pdf-to-markdown/route.test.ts`
- Create: `src/app/api/tools/conversions/[id]/assets/[assetId]/route.ts`
- Create: `src/app/api/tools/conversions/[id]/assets/[assetId]/route.test.ts`
- Modify: `src/app/api/tools/conversions/[id]/route.ts`
- Create: `src/app/api/tools/conversions/[id]/route.test.ts`

- [ ] **Step 1: Write failing persistence and ownership tests**

Test that a conversion ID is allocated before object upload, all assets are uploaded under that ID, database creation uses nested asset records, and a database failure removes every uploaded object. Test the asset GET route returns `401`, `404` for another user, and image bytes with `Content-Type` plus `private, max-age=3600` for the owner.

```ts
expect(mocks.uploadObjectBuffer).toHaveBeenCalledWith(
  expect.objectContaining({
    key: expect.stringContaining("/conversions/conversion-1/assets/"),
    mimeType: "image/png",
  })
);
expect(stream).toContain('"assetCount":1');
```

- [ ] **Step 2: Run route tests and confirm failure**

Run: `npm test -- src/app/api/tools/pdf-to-markdown/route.test.ts src/app/api/tools/conversions/[id]/assets/[assetId]/route.test.ts`

Expected: FAIL because asset persistence and route are absent.

- [ ] **Step 3: Implement conversion asset lifecycle**

Create helpers with explicit compensation semantics:

```ts
export async function storeConversionAssets(input: {
  userId: string;
  conversionId: string;
  assets: ParsedImageAsset[];
}): Promise<StoredConversionAsset[]>;

export async function deleteConversionObjects(input: {
  assets: StoredObjectRef[];
  exportObject?: StoredObjectRef | null;
}): Promise<void>;
```

The SSE route generates `conversionId`, uploads images, creates `DocumentConversion` plus nested asset rows, and sends `assetCount`. On failure it deletes uploaded objects. The DELETE route loads ownership, assets, and cached export before deleting object storage and the database record.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- src/lib/conversions/assets.test.ts src/app/api/tools/pdf-to-markdown/route.test.ts src/app/api/tools/conversions/[id]/assets/[assetId]/route.test.ts src/app/api/tools/conversions/[id]/route.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/conversions src/app/api/tools prisma
git commit -m "feat: persist and serve conversion images"
```

### Task 4: Reuse the complete chat Markdown renderer in conversion previews

**Files:**
- Create: `src/components/markdown/markdown-content.tsx`
- Create: `src/components/markdown/markdown-content.test.tsx`
- Modify: `src/components/chat/message-bubble.tsx`
- Modify: `src/components/chat/mermaid-block.tsx`
- Modify: `src/components/tools/conversion-viewer.tsx`
- Modify: `src/components/tools/pdf-convert-client.tsx`
- Modify: `src/app/(chat)/tools/[id]/page.tsx`
- Modify: `src/lib/api/types.ts`

- [ ] **Step 1: Write failing component tests**

Render Markdown containing a heading, table, math, code, and `pics/circuit.png`. Assert the shared component applies `markdown-body`, invokes the URL resolver, and exposes render-state markers. Assert conversion controls contain “下载完整包”“下载 .md”“保存到项目” and do not contain “复制”.

```tsx
render(
  <MarkdownContent
    content={'# 标题\n\n![电路](pics/circuit.png)'}
    resolveImageUrl={(src) => `/asset/${src}`}
  />
);
expect(screen.getByRole("img", { name: "电路" })).toHaveAttribute(
  "src",
  "/asset/pics/circuit.png"
);
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- src/components/markdown/markdown-content.test.tsx src/components/tools/conversion-viewer.test.tsx`

Expected: FAIL because the shared renderer and full-package action do not exist.

- [ ] **Step 3: Implement the shared renderer and UI**

Create `MarkdownContent` with the exact plugin stack currently duplicated in chat and conversion history:

```tsx
export function MarkdownContent({
  content,
  isStreaming = false,
  resolveImageUrl = (src) => src,
  className,
}: MarkdownContentProps) {
  return (
    <div className={cn("workbench-readable markdown-body break-words", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
        components={{
          img: ({ src = "", alt = "" }) => (
            <img src={resolveImageUrl(src)} alt={alt} loading="lazy" />
          ),
          code: markdownCodeComponent(isStreaming),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
```

Replace both conversion raw `<pre>` preview and historical duplicate renderer. Remove copy imports/state/actions. The SSE completion payload and conversion detail type expose `assets: Array<{ id: string; relativePath: string }>`; build a `Map<relativePath, id>` and resolve images to `/api/tools/conversions/${conversionId}/assets/${assetId}`. Never return or render raw storage paths.

- [ ] **Step 4: Run component tests**

Run: `npm test -- src/components/markdown/markdown-content.test.tsx src/components/tools/conversion-viewer.test.tsx`

Expected: renderer and action tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/markdown src/components/chat src/components/tools src/app/'(chat)'/tools src/lib/api/types.ts
git commit -m "feat: render complete conversion Markdown previews"
```

### Task 5: Copy images into projects and render project Markdown

**Files:**
- Modify: `src/app/api/tools/conversions/[id]/save-to-project/route.ts`
- Modify: `src/app/api/tools/conversions/[id]/save-to-project/route.test.ts`
- Create: `src/app/api/files/[id]/resources/[resourceId]/route.ts`
- Create: `src/app/api/files/[id]/resources/[resourceId]/route.test.ts`
- Modify: `src/app/api/files/[id]/route.ts`
- Modify: `src/app/api/projects/[id]/route.ts`
- Modify: `src/components/project/file-content-dialog.tsx`

- [ ] **Step 1: Write failing independent-resource tests**

Assert save-to-project reads each conversion asset, uploads it under the new file ID, creates nested `FileAssetResource` rows, and cleans all copied objects if the database write fails. Assert project resource ownership and deletion cleanup.

```ts
expect(mocks.fileAssetCreate).toHaveBeenCalledWith({
  data: expect.objectContaining({
    resources: {
      create: [expect.objectContaining({ relativePath: "pics/circuit.png" })],
    },
  }),
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- src/app/api/tools/conversions/[id]/save-to-project/route.test.ts src/app/api/files/[id]/resources/[resourceId]/route.test.ts`

Expected: FAIL because project resources are not copied or served.

- [ ] **Step 3: Implement project resource lifecycle and preview**

Include conversion assets in the ownership query, copy buffers via `readStoredObject` and `uploadObjectBuffer`, and create the file plus resources atomically. Return resource IDs in file GET. Use `MarkdownContent` in `FileContentDialog` when not editing, resolving `pics/...` against the file resource API. Extend file/project deletion queries to delete resource objects before database cascades.

- [ ] **Step 4: Run project tests**

Run: `npm test -- src/app/api/tools/conversions/[id]/save-to-project/route.test.ts src/app/api/files/[id]/resources/[resourceId]/route.test.ts src/app/api/projects/[id]/route.test.ts`

Expected: all project copy, ownership, and deletion tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/tools/conversions src/app/api/files src/app/api/projects src/components/project
git commit -m "feat: preserve conversion images in projects"
```

### Task 6: Embed images in DOCX and assemble the complete ZIP

**Files:**
- Modify: `src/lib/export/markdown-to-docx.ts`
- Modify: `src/lib/export/exporters.test.ts`
- Create: `src/lib/export/conversion-package.ts`
- Create: `src/lib/export/conversion-package.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install image conversion dependency and write failing export tests**

Run: `npm install sharp`

Add a DOCX test that unzips the result and finds `word/media/` bytes. Add a package test asserting exactly one sanitized root with `.md`, `.pdf`, `.docx`, and `pics/circuit.png`, and that Markdown references `pics/circuit.png`.

```ts
const packageZip = new AdmZip(await buildConversionPackage(input));
expect(packageZip.getEntry("lecture/lecture.pdf")?.getData()).toEqual(pdfBuffer);
expect(packageZip.getEntry("lecture/pics/circuit.png")?.getData()).toEqual(imageBuffer);
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- src/lib/export/exporters.test.ts src/lib/export/conversion-package.test.ts`

Expected: FAIL because image embedding and package assembly are absent.

- [ ] **Step 3: Implement image-aware DOCX and ZIP assembly**

Change the DOCX signature to accept an async image resolver without affecting existing callers:

```ts
export async function markdownToDocx(
  content: string,
  options: {
    resolveImage?: (src: string) => Promise<{ buffer: Buffer; mimeType: string } | null>;
  } = {}
): Promise<Buffer>;
```

Convert unsupported browser image formats to PNG through `sharp`, read dimensions, scale to a maximum content width, and emit `ImageRun`. Implement `buildConversionPackage` as a pure Buffer function that sanitizes the base name and writes all four required outputs.

- [ ] **Step 4: Run export tests**

Run: `npm test -- src/lib/export/exporters.test.ts src/lib/export/conversion-package.test.ts`

Expected: DOCX media and ZIP structure tests PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/lib/export
git commit -m "feat: export image-complete DOCX and ZIP packages"
```

### Task 7: Print the shared Markdown view to PDF and cache package downloads

**Files:**
- Create: `src/lib/export/browser-pdf.ts`
- Create: `src/lib/export/browser-pdf.test.ts`
- Create: `src/components/tools/export-ready-marker.tsx`
- Modify: `src/components/chat/mermaid-block.tsx`
- Modify: `src/components/tools/conversion-viewer.tsx`
- Modify: `src/app/(chat)/tools/[id]/page.tsx`
- Create: `src/app/api/tools/conversions/[id]/download/route.ts`
- Create: `src/app/api/tools/conversions/[id]/download/route.test.ts`
- Modify: `Dockerfile`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install browser dependency and write failing tests**

Run: `npm install playwright-core`

Mock `chromium.launch` and assert cookies are forwarded, the print URL contains `?print=1`, export readiness is awaited, and `page.pdf` uses A4/background options. Test the download route returns a cached object without launching Chromium and generates/uploads/updates once on a miss.

```ts
expect(page.goto).toHaveBeenCalledWith(
  "http://localhost/tools/conversion-1?print=1",
  expect.objectContaining({ waitUntil: "networkidle" })
);
expect(page.waitForFunction).toHaveBeenCalled();
expect(page.pdf).toHaveBeenCalledWith(expect.objectContaining({
  format: "A4",
  printBackground: true,
}));
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npm test -- src/lib/export/browser-pdf.test.ts src/app/api/tools/conversions/[id]/download/route.test.ts`

Expected: FAIL because browser printing and download route are absent.

- [ ] **Step 3: Implement print readiness and package caching**

`renderMarkdownPdf` resolves Chromium in this order: `CHROMIUM_EXECUTABLE_PATH`, common macOS Chrome paths, `/usr/bin/chromium`. It sets the incoming cookie header, navigates to the authenticated print view, waits for `document.documentElement.dataset.exportReady === "true"`, and always closes the browser.

The print view contains only the shared renderer. `ExportReadyMarker` waits for `document.fonts.ready`, all image load/error events, and no Mermaid block with `data-render-state="pending"`, then sets the document dataset flag.

The download route verifies ownership and loads assets, returns a cached ZIP when present, otherwise generates PDF, DOCX and ZIP, uploads the package, conditionally stores its reference, deletes an unselected concurrent candidate, and returns:

```ts
return new Response(new Uint8Array(zipBuffer), {
  headers: {
    "Content-Type": "application/zip",
    "Content-Disposition": contentDisposition(`${baseName}.zip`),
    "Cache-Control": "private, no-store",
  },
});
```

Install `chromium` in the Docker runner and set `CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`.

- [ ] **Step 4: Run browser/download tests**

Run: `npm test -- src/lib/export/browser-pdf.test.ts src/app/api/tools/conversions/[id]/download/route.test.ts`

Expected: all cache-hit, cache-miss, ownership, cookie, and browser-close tests PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json Dockerfile src/lib/export src/components/tools src/components/chat src/app/'(chat)'/tools src/app/api/tools/conversions
git commit -m "feat: generate and cache styled conversion packages"
```

### Task 8: Keep the main workspace navigation vertical

**Files:**
- Modify: `src/components/layout/sidebar.tsx`
- Create: `src/components/layout/sidebar-layout.test.tsx`

- [ ] **Step 1: Write a failing layout regression test**

Render the sidebar with its data hooks and session mocked. Locate the “聊天 / 项目 / 文档” navigation container and assert its three buttons are ordered vertically in both expanded and collapsed props. Give the menu a stable accessible label so the test targets behavior rather than internal class ordering:

```tsx
const { rerender } = render(
  <Sidebar mobileOpen={false} collapsed={false} onClose={vi.fn()} onExpand={vi.fn()} />
);
expect(screen.getByRole("list", { name: "工作空间导航" })).toHaveClass("flex-col");

rerender(
  <Sidebar mobileOpen={false} collapsed onClose={vi.fn()} onExpand={vi.fn()} />
);
expect(screen.getByRole("list", { name: "工作空间导航" })).toHaveClass("flex-col");
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npm test -- src/components/layout/sidebar-layout.test.tsx`

Expected: FAIL because the expanded menu currently overrides `SidebarMenu` with `grid-cols-3`.

- [ ] **Step 3: Restore a vertical layout in every sidebar state**

Use the existing `SidebarMenu` column layout instead of a three-column grid:

```tsx
<SidebarMenu aria-label="工作空间导航" className="gap-1">
  {/* 聊天、项目、文档 remain separate SidebarMenuItem rows */}
</SidebarMenu>
```

Keep active styles, labels, mobile behavior, collapsed icon centering, and click routing unchanged.

- [ ] **Step 4: Run the component test and verify in the browser**

Run: `npm test -- src/components/layout/sidebar-layout.test.tsx`

Expected: PASS. Then inspect `http://localhost:3000/chat` at expanded and collapsed desktop widths and confirm the three controls never share a row.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/sidebar.tsx src/components/layout/sidebar-layout.test.tsx
git commit -m "fix: keep workspace navigation vertical"
```

### Task 9: Migrate, document, and verify the complete flow

**Files:**
- Modify: `README.md` if the document tool export behavior is documented there
- Modify: `REPOSITORY_INDEX.md` locally only; do not stage
- Modify: `/Users/yinjunhang/Documents/LumenLab/PROJECT_SUMMARY.md` if current feature status is listed
- Modify: `/Users/yinjunhang/Documents/LumenLab/log.md`

- [ ] **Step 1: Run migration and complete automated verification**

Run:

```bash
npx prisma migrate dev
npm test
npm run lint
npm run build
```

Expected: migration applies, all tests pass, lint exits zero, and production build succeeds. Record any pre-existing Turbopack NFT warning separately from failures.

- [ ] **Step 2: Run the real circuit PDF acceptance test**

Use `/Users/yinjunhang/Downloads/电路原理高分精选考题.pdf` through the running application when a MinerU credential is available. Verify preview images, ZIP relative paths, PDF images/CSS, DOCX embedded media, and project independence after deleting the conversion. If credentials are unavailable, report the real API test as skipped and preserve passing fixture evidence.

- [ ] **Step 3: Update documentation and workspace log**

Update the repository index timestamp, file tree, data models, tool flow, new dependencies, Chromium deployment requirement, and image lifecycle. Append a `2026-06-20` log entry listing every modified workspace-relative file and exact test/lint/build results.

- [ ] **Step 4: Inspect final diff and commit**

Run:

```bash
git status --short
git diff --check
git diff --stat
```

Stage only intended repository files; never stage `REPOSITORY_INDEX.md`.

```bash
git add .
git commit -m "docs: document image-complete PDF conversion"
git push origin main
```

- [ ] **Step 5: Confirm final state**

Run: `git status --short --branch`

Expected: `main...origin/main` with no tracked or untracked implementation changes; `REPOSITORY_INDEX.md` may remain locally modified because it is intentionally ignored.
