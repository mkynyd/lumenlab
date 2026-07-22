import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  usePathname: vi.fn(),
}));

const profileDialogProps = vi.hoisted(() => ({
  current: null as null | {
    open: boolean;
    onOpenChange: (next: boolean) => void;
  },
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
  ProfileDialog: (props: {
    open: boolean;
    onOpenChange: (next: boolean) => void;
  }) => {
    profileDialogProps.current = props;
    return null;
  },
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

  it("can remove the desktop main navigation while preserving the mobile drawer", () => {
    const props = { mobileOpen: false, onClose: vi.fn(), onExpand: vi.fn() };
    render(<Sidebar {...props} collapsed hiddenOnDesktop />);

    expect(screen.getByLabelText("主导航侧边栏")).toHaveClass("lg:w-0");
    expect(screen.getByLabelText("主导航侧边栏")).toHaveClass("lg:pointer-events-none");
  });
});

describe("sidebar dialog hash wiring", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    profileDialogProps.current = null;
    window.history.replaceState(null, "", "/chat");
  });

  async function openProfileFromAccountMenu() {
    const props = { mobileOpen: false, onClose: vi.fn(), onExpand: vi.fn() };
    render(<Sidebar {...props} collapsed={false} />);
    // The account trigger toggles the controlled menu from its own
    // onPointerDown (preventDefault), not via the Radix trigger handler.
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "打开个人与设置" })
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "个人资料" })
    );
  }

  it("pushes #profile into the URL when the profile dialog opens from the account menu", async () => {
    await openProfileFromAccountMenu();

    expect(profileDialogProps.current?.open).toBe(true);
    expect(window.location.hash).toBe("#profile");
  });

  it("closes the dialog through closeDialog (history.back), not a bare setOpen", async () => {
    const backSpy = vi
      .spyOn(window.history, "back")
      .mockImplementation(() => {});
    await openProfileFromAccountMenu();
    expect(window.location.hash).toBe("#profile");

    // jsdom does not reliably dispatch popstate from history.back(), so we
    // assert on the back() call itself: closeDialog() routes a pushed entry
    // through history.back() instead of flipping open state directly.
    act(() => profileDialogProps.current?.onOpenChange(false));
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it("switches from settings to profile exclusively", async () => {
    const props = { mobileOpen: false, onClose: vi.fn(), onExpand: vi.fn() };
    render(<Sidebar {...props} collapsed={false} />);

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "打开个人与设置" })
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "设置" }));
    expect(window.location.hash).toBe("#settings");

    // The open settings dialog aria-hides the sidebar, so the trigger and
    // menu items are queried with hidden: true.
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "打开个人与设置", hidden: true })
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "个人资料", hidden: true })
    );

    expect(window.location.hash).toBe("#profile");
    expect(profileDialogProps.current?.open).toBe(true);
    // The settings dialog (the only real Radix dialog in the tree, since
    // ProfileDialog is mocked) must be gone: the two are mutually exclusive.
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
