import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Navbar } from "@/components/layout/navbar";

const navigation = vi.hoisted(() => ({ pathname: "/chat" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));

describe("Navbar", () => {
  it("announces the closed mobile navigation independently of desktop collapse", () => {
    navigation.pathname = "/chat";
    render(
      <Navbar
        onMenuToggle={vi.fn()}
        sidebarCollapsed={false}
        mobileSidebarOpen={false}
      />
    );

    expect(screen.getByRole("button", { name: "打开导航" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
  });

  it("only marks a primary mode current on its own route", () => {
    navigation.pathname = "/usage";
    render(<Navbar />);

    expect(screen.getByRole("link", { name: "聊天" })).not.toHaveAttribute(
      "aria-current"
    );
    expect(screen.getByRole("link", { name: "项目" })).not.toHaveAttribute(
      "aria-current"
    );
  });
});
