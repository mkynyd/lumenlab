import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Onboarding2 from "./onboarding-2";
function next() { fireEvent.click(screen.getByRole("button", { name: "下一步" })); }
describe("collection onboarding", () => {
  it("collects stage, subject, syllabus and notebook before one creation", async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    render(<Onboarding2 onCreate={create} onCancel={() => {}} />);
    for (const name of ["学习阶段", "学科与考试", "考试大纲", "题集与错题本"]) {
      expect(screen.getByRole("button", { name })).toHaveTextContent(name);
    }
    expect(screen.getByRole("heading", { name: "学习阶段" })).toBeVisible();
    expect(screen.getByText("选择学段和年级，用于整理题集与筛选题库。")).toBeVisible();
    expect(screen.getByText("年级（选填）", { selector: "span" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("年级（选填）"), { target: { value: "大三" } }); next();
    fireEvent.change(screen.getByLabelText("学科"), { target: { value: "数学" } });
    fireEvent.change(screen.getByLabelText("考试（选填）"), { target: { value: "考研数学二" } }); next();
    fireEvent.change(screen.getByLabelText("考试大纲或知识范围（选填）"), { target: { value: "极限与连续" } }); next();
    expect(create).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("题集名称"), { target: { value: "2027数学二" } });
    fireEvent.click(screen.getByRole("button", { name: "创建题集" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).toMatchObject({ name: "2027数学二", stage: "university", grade: "大三", subject: "数学", exam: "考研数学二", syllabus: "极限与连续", notebookName: "错题本" });
  });
  it("does not advance without the subject", () => {
    render(<Onboarding2 onCreate={vi.fn()} onCancel={() => {}} />); next(); next();
    expect(screen.getByRole("alert")).toHaveTextContent("请填写学科");
    expect(screen.getByLabelText("学科")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeVisible();
  });
  it("cancels without creating data", () => {
    const create = vi.fn(), cancel = vi.fn();
    render(<Onboarding2 onCreate={create} onCancel={cancel} />);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(cancel).toHaveBeenCalledOnce(); expect(create).not.toHaveBeenCalled();
  });
});
