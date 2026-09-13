import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { ChatInput } from "@/components/chat/chat-input";

type ChatInputProps = ComponentProps<typeof ChatInput>;

const chatInputSpy = vi.fn();

vi.mock("@/components/chat/chat-input", () => ({
  ChatInput: (props: ChatInputProps) => {
    chatInputSpy(props);
    return <textarea aria-label="消息内容" placeholder={props.placeholder} />;
  },
}));

vi.mock("@/lib/hooks/use-available-models", () => ({
  useAvailableChatModels: () => ({ availableModels: ["qwen3.8-flash", "qwen3.8-max", "deepseek-flash", "minimax-m3"], catalogError: null }),
}));

const { ResearchComposer } = await import("./research-composer");

function latestChatInputProps(): ChatInputProps {
  const calls = chatInputSpy.mock.calls;
  return calls[calls.length - 1][0] as ChatInputProps;
}

describe("ResearchComposer", () => {
  it("renders budget and domain selects with defaults and passes the research placeholder", () => {
    render(<ResearchComposer onSend={vi.fn()} showDomainSelect />);
    expect(screen.getByLabelText("研究强度")).toHaveTextContent("Deep · 深入");
    expect(screen.getByLabelText("研究领域 Profile")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/输入一个研究问题/)).toBeInTheDocument();
  });

  it("hides the domain select by default", () => {
    render(<ResearchComposer onSend={vi.fn()} />);
    expect(screen.queryByLabelText("研究领域 Profile")).not.toBeInTheDocument();
    expect(screen.getByLabelText("研究强度")).toBeInTheDocument();
  });

  it("passes the default commander model and server-provided catalog to ChatInput", () => {
    render(<ResearchComposer onSend={vi.fn()} />);
    const props = latestChatInputProps();
    expect(props.model).toBe("qwen3.8-flash");
    expect(props.availableModels).toEqual(["qwen3.8-flash", "qwen3.8-max", "deepseek-flash", "minimax-m3"]);
  });

  it("submits question, attachments and options, including the domain key only when shown", async () => {
    const onSend = vi.fn(async () => true);
    render(<ResearchComposer onSend={onSend} showDomainSelect initialDomainProfileKey="computer_science" initialBudgetProfile="comprehensive" />);
    const attachment = { id: "a1", name: "paper.pdf", mimeType: "application/pdf", size: 12, data: new File(["x"], "paper.pdf") };
    const props = latestChatInputProps();
    await props.onSend("比较两种路由方法", [attachment]);
    expect(onSend).toHaveBeenCalledWith("比较两种路由方法", [attachment], {
      budgetProfile: "comprehensive",
      commanderModel: "qwen3.8-flash",
      domainProfileKey: "computer_science",
    });
  });

  it("omits domainProfileKey when the domain select is hidden", async () => {
    const onSend = vi.fn(async () => true);
    render(<ResearchComposer onSend={onSend} />);
    await latestChatInputProps().onSend("问题", []);
    expect(onSend).toHaveBeenCalledWith("问题", [], {
      budgetProfile: "deep",
      commanderModel: "qwen3.8-flash",
    });
  });

  it("propagates a false result so ChatInput keeps the draft for retry", async () => {
    const onSend = vi.fn(async () => false);
    render(<ResearchComposer onSend={onSend} />);
    const result = await latestChatInputProps().onSend("问题", []);
    expect(result).toBe(false);
  });
});
