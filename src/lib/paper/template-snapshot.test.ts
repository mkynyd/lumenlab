import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { githubRepositorySlug, normalizeTemplateZip } from "./template-snapshot";

describe("template upstream snapshots", () => {
  it("accepts only GitHub owner/repository identities", () => {
    expect(githubRepositorySlug("https://github.com/tuna/thuthesis.git")).toBe("tuna/thuthesis");
    expect(githubRepositorySlug("https://example.com/tuna/thuthesis")).toBeNull();
  });

  it("strips archive roots and rejects unsafe files through the shared policy", async () => {
    const zip = new JSZip();
    zip.file("repo-v1/main.tex", "\\documentclass{article}");
    zip.file("repo-v1/assets/figure.png", Buffer.from([1, 2, 3]));
    const result = await normalizeTemplateZip(await zip.generateAsync({ type: "nodebuffer" }));
    const repeated = await normalizeTemplateZip(await zip.generateAsync({ type: "nodebuffer" }));
    expect(result.files).toEqual(["assets/figure.png", "main.tex"]);
    expect(result.sha256).toHaveLength(64);
    expect(repeated.sha256).toBe(result.sha256);
    expect(repeated.buffer.equals(result.buffer)).toBe(true);
  });
});
