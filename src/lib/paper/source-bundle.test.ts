import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { sourceBundle } from "./compile-worker";

describe("paper source bundle", () => {
  it("keeps the manifest and materialized asset in the exported LaTeX project", async () => {
    const bundle = await sourceBundle({ mainTex: "main", generatedContentTex: "content", referencesBib: "refs", manifest: { id: "template-v1" }, assets: [{ path: "assets/figure.png", buffer: Buffer.from([1, 2, 3]) }] });
    const zip = await JSZip.loadAsync(bundle);
    expect(await zip.file("template-manifest.json")?.async("string")).toContain("template-v1");
    expect(await zip.file("assets/figure.png")?.async("nodebuffer")).toEqual(Buffer.from([1, 2, 3]));
  });
});
