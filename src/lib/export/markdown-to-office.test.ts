// @vitest-environment node

import AdmZip from "adm-zip";
import { read, utils } from "xlsx";
import { describe, expect, it } from "vitest";
import { markdownToSlides, markdownToWorkbook } from "./markdown-to-office";

describe("chat Office deliverables", () => {
  it("opens as an editable workbook and preserves IDs without evaluating embedded formulas", async () => {
    const data = "## 汇总\n\n| 编号 | 数量 | 备注 |\n| --- | --- | --- |\n| 0012 | 34 | =1+1 |";
    const workbook = read(await markdownToWorkbook(data));
    const sheet = workbook.Sheets["汇总"];
    expect(utils.sheet_to_json(sheet, { header: 1 })).toEqual([
      ["编号", "数量", "备注"], ["0012", 34, "=1+1"],
    ]);
    expect(sheet.C2.f).toBeUndefined();
  });

  it("produces editable text in separately packaged slides", async () => {
    const file = new AdmZip(await markdownToSlides("## 安排\n\n- 第一节\n\n## 总结\n\n- 第二节", "自习计划"));
    expect(file.readAsText("ppt/slides/slide1.xml")).toContain("第一节");
    expect(file.readAsText("ppt/slides/slide2.xml")).toContain("第二节");
  });
});
