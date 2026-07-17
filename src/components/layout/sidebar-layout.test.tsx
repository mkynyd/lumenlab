import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  usePathname: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  usePathname: mocks.usePathname,
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { name: "测试用户" } } }),
  signOut: vi.fn(),
}));
vi.mock("@/lib/hooks/use-conversations", () => ({
  useConversations: () => ({ data: [], isPending: false }),
  useDeleteConversation: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/lib/hooks/use-projects", () => ({
  useProjects: () => ({ data: [], isPending: false }),
  useDeleteProject: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/lib/hooks/use-conversions", () => ({
  useConversions: () => ({ data: [], isPending: false }),
  useDeleteConversion: () => ({
    mutateAsync: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    isError: false,
  }),
}));
vi.mock("@/components/settings/settings-panel", () => ({
  SettingsPanel: () => null,
}));
vi.mock("@/components/user/profile-dialog", () => ({
  ProfileDialog: () => null,
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

import { Sidebar } from "@/components/layout/sidebar";

describe("main workspace navigation layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.usePathname.mockReturnValue("/chat");
  });

  it("keeps chat, projects, and documents in vertical rows when expanded or collapsed", () => {
    const props = { mobileOpen: false, onClose: vi.fn(), onExpand: vi.fn() };
    const { rerender } = render(<Sidebar {...props} collapsed={false} />);

    const expanded = screen.getByRole("list", { name: "工作空间导航" });
    expect(expanded).toHaveClass("flex-col");
    expect(expanded).not.toHaveClass("grid");

    rerender(<Sidebar {...props} collapsed />);

    const collapsed = screen.getByRole("list", { name: "工作空间导航" });
    expect(collapsed).toHaveClass("flex-col");
    expect(collapsed).not.toHaveClass("grid");
  });

  it("names the document conversion workspace as conversions", () => {
    const props = { mobileOpen: false, onClose: vi.fn(), onExpand: vi.fn() };
    render(<Sidebar {...props} collapsed={false} />);

    expect(screen.getByRole("button", { name: "转换" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "文档" })).not.toBeInTheDocument();
  });
});
