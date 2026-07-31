import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FreshnessBadge } from "@/components/learning/freshness-badge";

describe("FreshnessBadge", () => {
  it("renders nothing for current content", () => {
    const { container } = render(<FreshnessBadge freshness="current" />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders the revalidation hint as plain text", () => {
    render(<FreshnessBadge freshness="needs_revalidation" />);

    expect(screen.getByText("资料待更新")).toBeInTheDocument();
  });

  it("renders the unsupported hint as plain text", () => {
    render(<FreshnessBadge freshness="unsupported" />);

    expect(screen.getByText("资料不可用")).toBeInTheDocument();
  });
});
