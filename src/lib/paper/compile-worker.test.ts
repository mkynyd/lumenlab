import { describe, expect, it } from "vitest";
import { buildCompileCommands, compilerCommand } from "./compile-worker";

describe("paper compilation command planning", () => {
  it("plans latexmk with the selected engine and BibTeX without shell escape", () => {
    const commands = buildCompileCommands({ engine: "xelatex", bibliography: "bibtex" });
    expect(commands[0]).toMatchObject({ command: "latexmk", phase: "latexmk" });
    expect(commands[0].args).toEqual(expect.arrayContaining(["-xelatex", "-bibtex", "-no-shell-escape", "-synctex=1", "main.tex"]));
    expect(commands.every((command) => !command.args.includes("-shell-escape"))).toBe(true);
  });

  it("plans an explicit Biber fallback and rejects unsupported engines", () => {
    const commands = buildCompileCommands({ engine: "lualatex", bibliography: "biblatex/biber", preferLatexmk: false });
    expect(commands.map((command) => command.command)).toEqual(["lualatex", "biber", "lualatex", "lualatex"]);
    expect(() => compilerCommand("context")).toThrow("只允许");
  });

  it("does not invoke bibliography tooling for a document without a backend", () => {
    const commands = buildCompileCommands({ engine: "pdflatex", bibliography: "none", preferLatexmk: false });
    expect(commands.map((command) => command.command)).toEqual(["pdflatex", "pdflatex"]);
  });
});
