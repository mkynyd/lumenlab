import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
}));

// AuthShell 带点阵 canvas 背景，与注册流程逻辑无关，隔离掉
vi.mock("@/components/auth/auth-shell", () => ({
  AuthShell: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

import RegisterPage from "@/app/(auth)/register/page";

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/auth/verify/send")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, resendAfter: 60 }),
      } as Response;
    }
    if (url.includes("/api/auth/verify/code")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, ticket: "ticket-1" }),
      } as Response;
    }
    if (url.includes("/api/auth/register")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response;
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

// 步骤导航按钮与 Next 按钮可能同名（如「验证」），Next 按钮不带 aria-current
function nextButton(name: RegExp | string) {
  const matches = screen.getAllByRole("button", { name });
  const next = matches.find((el) => !el.hasAttribute("aria-current"));
  if (!next) throw new Error(`next button not found: ${String(name)}`);
  return next;
}

// 步骤内容渲染在 role="group" 容器内，在其中查询可避免命中步骤导航标题
function stepContent() {
  return within(screen.getByRole("group"));
}

async function reachPasswordStep(user: ReturnType<typeof userEvent.setup>) {
  await user.type(stepContent().getByLabelText("邮箱"), "test@example.com");
  await user.click(nextButton(/发送验证邮件/));
  await waitFor(() => {
    expect(stepContent().getByLabelText("验证码")).toBeInTheDocument();
  });
  await user.type(stepContent().getByLabelText("验证码"), "123456");
  await user.click(nextButton(/^验证$/));
  await waitFor(() => {
    expect(stepContent().getByLabelText("密码")).toBeInTheDocument();
  });
  await user.type(stepContent().getByLabelText("密码"), "password-8");
  await user.type(stepContent().getByLabelText("确认密码"), "password-8");
}

describe("RegisterPage 协议勾选", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    push.mockClear();
  });

  it("未勾选协议时阻止注册并提示", async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    await reachPasswordStep(user);

    await user.click(nextButton(/创建账户/));

    expect(
      await screen.findByText("请先阅读并勾选同意用户协议与隐私政策")
    ).toBeInTheDocument();
    const fetchMock = vi.mocked(fetch);
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes("/api/auth/register")
      )
    ).toBe(false);
  });

  it("勾选协议后正常提交注册", async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    await reachPasswordStep(user);

    await user.click(
      stepContent().getByRole("checkbox", { name: /注册登录即代表已阅读并同意/ })
    );
    await user.click(nextButton(/创建账户/));

    expect(
      await screen.findByText("注册成功", undefined, { timeout: 5_000 })
    ).toBeInTheDocument();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([url]) => String(url).includes("/api/auth/register"))
    ).toBe(true);
  });

  it("协议文案包含指向 /legal 页面的链接", async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    await reachPasswordStep(user);

    expect(screen.getByRole("link", { name: "用户协议" })).toHaveAttribute(
      "href",
      "/legal/terms"
    );
    expect(screen.getByRole("link", { name: "隐私政策" })).toHaveAttribute(
      "href",
      "/legal/privacy"
    );
  });
});
