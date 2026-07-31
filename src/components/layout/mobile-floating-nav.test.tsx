import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MobileFloatingNav } from "@/components/layout/mobile-floating-nav";

const navigation = vi.hoisted(() => ({ pathname: "/chat" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));

describe("MobileFloatingNav", () => {
  it("announces the closed mobile navigation independently of desktop collapse", () => {
    navigation.pathname = "/chat";
    render(
      <MobileFloatingNav onMenuToggle={vi.fn()} mobileSidebarOpen={false} />
    );

    expect(screen.getByRole("button", { name: "打开导航" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
  });

  it("only marks a primary mode current on its own route", () => {
    navigation.pathname = "/usage";
    render(<MobileFloatingNav />);

    expect(screen.getByRole("link", { name: "聊天" })).not.toHaveAttribute(
      "aria-current"
    );
    expect(screen.getByRole("link", { name: "项目" })).not.toHaveAttribute(
      "aria-current"
    );
    expect(screen.queryByRole("link", { name: "今日" })).not.toBeInTheDocument();
  });

  it("shows Today only for a server-authorized learning rollout", () => {
    navigation.pathname = "/today";
    const { rerender } = render(<MobileFloatingNav />);

    expect(screen.queryByRole("link", { name: "今日" })).not.toBeInTheDocument();

    rerender(<MobileFloatingNav learningNavigationVisible />);
    expect(screen.getByRole("link", { name: "今日" })).toHaveAttribute(
      "aria-current",
      "page"
    );
  });

  it("stays hidden on desktop viewports", () => {
    navigation.pathname = "/chat";
    const { container } = render(<MobileFloatingNav />);

    expect(container.firstChild).toHaveClass("lg:hidden");
  });
});
