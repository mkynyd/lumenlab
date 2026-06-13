import { render, screen } from "@testing-library/react";
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
});
