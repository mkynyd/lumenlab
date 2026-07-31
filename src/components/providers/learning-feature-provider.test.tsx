import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  LearningFeatureProvider,
  useLearningFeatureVisibility,
} from "@/components/providers/learning-feature-provider";

function Probe() {
  const visible = useLearningFeatureVisibility();
  return <output>{visible ? "visible" : "hidden"}</output>;
}

describe("LearningFeatureProvider", () => {
  it("fails closed without a server-provided value", () => {
    render(<Probe />);
    expect(screen.getByText("hidden")).toBeInTheDocument();
  });

  it("exposes the server-authorized navigation state to nested clients", () => {
    render(
      <LearningFeatureProvider navigationVisible>
        <Probe />
      </LearningFeatureProvider>
    );
    expect(screen.getByText("visible")).toBeInTheDocument();
  });
});
