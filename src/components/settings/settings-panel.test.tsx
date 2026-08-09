import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useCacheMetrics: vi.fn(),
  fetch: vi.fn()
}));

vi.stubGlobal("fetch", mocks.fetch);

vi.mock("@/components/ui/theme-toggle", () => ({
  ThemeToggle: () => <div>Theme toggle</div>
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: {
        name: "测试用户",
        email: "user@example.com",
        avatarPreset: "lumen",
        image: null
      }
    }
  }),
  signOut: vi.fn()
}));

vi.mock("@/lib/hooks/use-cache-metrics", () => ({
  useCacheMetrics: mocks.useCacheMetrics
}));

import { SettingsPanel } from "@/components/settings/settings-panel";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

beforeEach(() => {
  mocks.fetch.mockReset();
  mocks.useCacheMetrics.mockReturnValue({ isPending: false, data: null });
});

function mockPersonaFetch(
  persona: Record<string, unknown> = {
    profileName: "殷同学",
    profileProfession: "计算机学院本科生",
    profileDetails: "正在学习操作系统",
    profilePrompt: "已有的个人描述"
  }
) {
  mocks.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method || "GET";
    if (url === "/api/user/persona" && method === "GET") {
      return jsonResponse(persona);
    }
    if (url === "/api/user/persona" && method === "PUT") {
      return jsonResponse({ success: true });
    }
    if (url === "/api/user/generate-profile" && method === "POST") {
      return jsonResponse({ profilePrompt: "新生成的个人描述" });
    }
    if (url === "/api/user/password" && method === "POST") {
      return jsonResponse({ success: true });
    }
    return jsonResponse({ error: "not found" }, 404);
  });
}

describe("SettingsPanel token usage", () => {
  it("shows measured token totals and marks providers without data as unavailable", () => {
    mockPersonaFetch();
    mocks.useCacheMetrics.mockReturnValue({
      isPending: false,
      data: {
        cycle: {
          start: "2026-07-01T00:00:00.000Z",
          end: "2026-07-31T00:00:00.000Z"
        },
        tokenUsage: {
          totalTokens: 42_100,
          todayTokens: 6_100,
          requestCount: 5,
          unattributedTokens: 30_000,
          estimatedCostCny: 0.5,
          inputTokens: 30_000,
          outputTokens: 12_100,
          inputCacheHitTokens: 20_000,
          inputCacheMissTokens: 10_000,
          daily: [
            {
              date: "2026-07-01",
              totalTokens: 42_100,
              inputCacheHitTokens: 20_000,
              inputCacheMissTokens: 10_000,
              outputTokens: 12_100
            }
          ],
          providers: {
            deepseek: {
              totalTokens: 12_100,
              requestCount: 2,
              estimatedCostCny: 0.3
            },
            minimax: { totalTokens: 0, requestCount: 0, estimatedCostCny: 0 },
            bailian: { totalTokens: 0, requestCount: 0, estimatedCostCny: 0 }
          }
        },
        rag: {
          search: { hits: 1, misses: 1, hitRate: 0.5 },
          "file-select": { hits: 0, misses: 0, hitRate: 0 },
          "query-embed": { hits: 0, misses: 0, hitRate: 0 }
        }
      }
    });

    render(<SettingsPanel />);

    // Sidebar tabs should be visible
    expect(screen.getByText("服务访问")).toBeInTheDocument();
    expect(screen.getByText("用量统计")).toBeInTheDocument();
    expect(screen.getByText("个性化")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "服务访问" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(
      screen.getByRole("tabpanel", { name: "服务访问" })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "用量统计" }));

    expect(screen.getByRole("tab", { name: "用量统计" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(
      screen.getByRole("tabpanel", { name: "用量统计" })
    ).toBeInTheDocument();
    expect(mocks.useCacheMetrics).toHaveBeenCalledWith("cycle");
    expect(screen.getByText("42,100")).toBeInTheDocument();
    const usageBar = screen.getByRole("button", {
      name: "2026-07-01 共 42,100 tokens"
    });

    fireEvent.mouseEnter(usageBar);

    expect(screen.getByText("输入（命中缓存）")).toBeInTheDocument();
    expect(screen.getByText("输入（未命中缓存）")).toBeInTheDocument();
    expect(screen.getByText("输出")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "个性化" }));

    expect(screen.getByText("AI 画像")).toBeInTheDocument();
    expect(screen.queryByText("账户信息")).not.toBeInTheDocument();
    // 移动端设置首页提供 ChatGPT 式的退出登录入口（桌面端仍在侧边栏菜单里）
    expect(screen.getByText("退出登录")).toBeInTheDocument();
    expect(screen.queryByText("上传头像")).not.toBeInTheDocument();
  });
});


describe("PersonalizationSection persistence", () => {
  it("loads saved persona fields and the existing profile prompt", async () => {
    mockPersonaFetch();
    render(<SettingsPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "个性化" }));

    expect(await screen.findByDisplayValue("殷同学")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("计算机学院本科生")
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("正在学习操作系统")).toBeInTheDocument();
    // 已生成的个人描述以只读文本区展示，按钮变为重新生成
    expect(screen.getByDisplayValue("已有的个人描述")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "重新生成" })
    ).toBeInTheDocument();
    expect(mocks.fetch).toHaveBeenCalledWith("/api/user/persona");
  });

  it("auto-saves on blur and shows the real save status", async () => {
    mockPersonaFetch();
    render(<SettingsPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "个性化" }));

    const nameInput = await screen.findByDisplayValue("殷同学");
    fireEvent.change(nameInput, { target: { value: "新名字" } });
    fireEvent.blur(nameInput);

    // 失焦后 debounce 约 800ms 触发 PUT
    await waitFor(
      () => {
        expect(mocks.fetch).toHaveBeenCalledWith(
          "/api/user/persona",
          expect.objectContaining({
            method: "PUT",
            body: JSON.stringify({
              profileName: "新名字",
              profileProfession: "计算机学院本科生",
              profileDetails: "正在学习操作系统"
            })
          })
        );
      },
      { timeout: 3000 }
    );

    expect(await screen.findByText("已保存")).toBeInTheDocument();
  });

  it("does not save again when nothing changed since the last save", async () => {
    mockPersonaFetch();
    render(<SettingsPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "个性化" }));

    const nameInput = await screen.findByDisplayValue("殷同学");
    fireEvent.blur(nameInput);

    await new Promise((resolve) => setTimeout(resolve, 900));

    expect(
      mocks.fetch.mock.calls.filter(
        ([url, init]) =>
          url === "/api/user/persona" &&
          (init as RequestInit | undefined)?.method === "PUT"
      )
    ).toHaveLength(0);
  });

  it("displays the generated profile prompt returned by the API", async () => {
    mockPersonaFetch();
    render(<SettingsPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "个性化" }));

    await screen.findByDisplayValue("殷同学");
    fireEvent.click(screen.getByRole("button", { name: "重新生成" }));

    await waitFor(() => {
      expect(mocks.fetch).toHaveBeenCalledWith(
        "/api/user/generate-profile",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            nickname: "殷同学",
            profession: "计算机学院本科生",
            details: "正在学习操作系统"
          })
        })
      );
    });

    expect(
      await screen.findByDisplayValue("新生成的个人描述")
    ).toBeInTheDocument();
  });
});

describe("SecuritySection change password", () => {
  function fillPasswordForm({
    current = "old-password-1",
    next = "new-password-123",
    confirm = "new-password-123"
  } = {}) {
    fireEvent.change(screen.getByLabelText("当前密码"), {
      target: { value: current }
    });
    fireEvent.change(screen.getByLabelText("新密码"), {
      target: { value: next }
    });
    fireEvent.change(screen.getByLabelText("确认新密码"), {
      target: { value: confirm }
    });
  }

  it("rejects mismatched confirmations on the client", async () => {
    render(<SettingsPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "账号安全" }));

    fillPasswordForm({ confirm: "different-password" });
    fireEvent.click(screen.getByRole("button", { name: "修改密码" }));

    expect(
      await screen.findByText("两次输入的新密码不一致")
    ).toBeInTheDocument();
    expect(mocks.fetch).not.toHaveBeenCalledWith(
      "/api/user/password",
      expect.anything()
    );
  });

  it("submits the change, shows success and clears the form", async () => {
    mockPersonaFetch();
    render(<SettingsPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "账号安全" }));

    fillPasswordForm();
    fireEvent.click(screen.getByRole("button", { name: "修改密码" }));

    await waitFor(() => {
      expect(mocks.fetch).toHaveBeenCalledWith(
        "/api/user/password",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            currentPassword: "old-password-1",
            newPassword: "new-password-123"
          })
        })
      );
    });

    expect(await screen.findByText("密码已修改")).toBeInTheDocument();
    expect(screen.getByLabelText("当前密码")).toHaveValue("");
    expect(screen.getByLabelText("新密码")).toHaveValue("");
    expect(screen.getByLabelText("确认新密码")).toHaveValue("");
  });

  it("shows the server error when the change fails", async () => {
    mocks.fetch.mockImplementation(async () =>
      jsonResponse({ error: "当前密码不正确" }, 400)
    );
    render(<SettingsPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "账号安全" }));

    fillPasswordForm();
    fireEvent.click(screen.getByRole("button", { name: "修改密码" }));

    expect(await screen.findByText("当前密码不正确")).toBeInTheDocument();
    expect(screen.queryByText("密码已修改")).not.toBeInTheDocument();
  });
});
