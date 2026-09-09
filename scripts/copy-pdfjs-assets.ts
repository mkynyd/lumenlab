import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * pdf.js needs its CMap and standard-font tables to render CID-keyed CJK fonts.
 * Without them the in-app viewer silently drops every Chinese glyph while the
 * downloaded PDF (rendered by the browser's own engine) looks correct.
 *
 * The tables ship inside `node_modules/pdfjs-dist`, so they are copied into
 * `public/pdfjs/` before dev/build instead of being committed (1.6 MB + 800 KB).
 */
const source = join(process.cwd(), "node_modules", "pdfjs-dist");
const target = join(process.cwd(), "public", "pdfjs");

async function installedVersion(): Promise<string> {
  const packageJson = JSON.parse(await readFile(join(source, "package.json"), "utf8")) as { version?: string };
  return packageJson.version ?? "unknown";
}

async function main() {
  const version = await installedVersion();
  const marker = join(target, ".version");
  const current = await readFile(marker, "utf8").catch(() => null);
  if (current?.trim() === version) {
    console.log(`[pdfjs-assets] up to date (${version})`);
    return;
  }
  await mkdir(target, { recursive: true });
  for (const directory of ["cmaps", "standard_fonts"]) {
    await cp(join(source, directory), join(target, directory), { recursive: true, force: true });
  }
  await writeFile(marker, `${version}\n`, "utf8");
  console.log(`[pdfjs-assets] copied cmaps and standard_fonts for pdfjs-dist ${version}`);
}

main().catch((error) => {
  console.error("[pdfjs-assets] failed", error);
  process.exitCode = 1;
});
