import { describe, expect, it } from "vitest";
import { buildCompileCommands, buildCompileInvocation, compilerCommand } from "./compile-worker";

describe("paper compilation command planning", () => {
  it("plans latexmk with the selected engine and BibTeX without shell escape", () => {
    const commands = buildCompileCommands({ engine: "xelatex", bibliography: "bibtex" });
    expect(commands[0]).toMatchObject({ command: "latexmk", phase: "latexmk" });
    expect(commands[0].args).toEqual(expect.arrayContaining(["-norc", "-xelatex", "-no-shell-escape", "-synctex=1", "main.tex"]));
    expect(commands.map((command) => command.command)).toContain("bibtex");
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

  it("wraps TeX commands in a network-isolated Linux sandbox when enabled", () => {
    const invocation = buildCompileInvocation({
      cwd: "/tmp/lumenlab-paper-example",
      command: { command: "xelatex", args: ["main.tex"], phase: "engine" },
      environment: { PAPER_COMPILE_LINUX_SANDBOX: "true" },
    });
    expect(invocation.command).toBe("bwrap");
    expect(invocation.args).toEqual(expect.arrayContaining([
      "--unshare-net",
      "--ro-bind",
      "/",
      "--bind",
      "/tmp/lumenlab-paper-example",
      "/compile-workspace",
      "--clearenv",
      "--setenv",
      "HOME",
      "/compile-workspace/.home",
      "--",
      "xelatex",
      "main.tex",
    ]));
    expect(invocation.env).toEqual({ NODE_ENV: "production", PATH: "/usr/local/bin:/usr/bin:/bin" });
  });
});
