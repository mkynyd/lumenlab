import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChatInput } from "@/components/chat/chat-input";

describe("ChatInput", () => {
  it("shows an externally filled prompt and lets the user edit it", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();

    render(
      <ChatInput
        value="请基于资料生成实验报告"
        onValueChange={onValueChange}
        onSend={vi.fn()}
      />
    );

    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("请基于资料生成实验报告");

    await user.type(input, "，并标注缺失项");
    expect(onValueChange).toHaveBeenCalled();
  });

  it("gives the message editor an accessible name", () => {
    render(<ChatInput onSend={vi.fn()} />);

    expect(screen.getByRole("textbox", { name: "消息内容" })).toBeInTheDocument();
  });

  it("puts mobile-only secondary controls behind the compact action button", async () => {
    const user = userEvent.setup();
    const onModelChange = vi.fn();

    render(
      <ChatInput
        onSend={vi.fn()}
        model="deepseek-v4-pro"
        onModelChange={onModelChange}
        availableModels={["deepseek-v4-flash", "deepseek-v4-pro"]}
        onSkillChange={vi.fn()}
        onWebSearchToggle={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "更多输入选项" }));

    const tools = await screen.findByRole("dialog", { name: "对话选项" });
    expect(within(tools).getByRole("button", { name: "文件" })).toBeInTheDocument();
    expect(within(tools).getByRole("button", { name: "联网" })).toBeInTheDocument();

    await user.click(within(tools).getByRole("button", { name: "快速" }));
    expect(onModelChange).toHaveBeenCalledWith("deepseek-v4-flash");
  });
});
