import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("./virtual-message-list", () => ({ VirtualMessageList: () => <div>已发送消息</div> }));
import { ChatArea } from "./chat-area";
afterEach(() => vi.unstubAllGlobals());

it("clears the accepted prompt after the empty-chat composer unmounts and preserves the next draft", async () => {
  let accept!: (value: Response) => void;
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === "/api/chat") return new Promise<Response>((resolve) => { accept = resolve; });
    return Response.json({ models: ["deepseek-flash"] });
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
  render(<ChatArea />, { wrapper });
  await waitFor(() => expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled());
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "生成教案" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "发送消息" })).toBeEnabled());
  const emptyComposer = screen.getByRole("textbox");
  fireEvent.keyDown(emptyComposer, { key: "Enter" });
  await waitFor(() => expect(accept).toBeDefined());
  expect(emptyComposer).not.toBeInTheDocument();
  await act(async () => accept(new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }))));
  await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue(""));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "下一条草稿" } });
  await act(async () => { stream.enqueue(new TextEncoder().encode("data: [DONE]\n\n")); stream.close(); });
  await waitFor(() => expect(screen.queryByRole("button", { name: "停止生成" })).not.toBeInTheDocument());
  expect(screen.getByRole("textbox")).toHaveValue("下一条草稿");
});
