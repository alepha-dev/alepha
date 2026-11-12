import { fireEvent, render, screen } from "@testing-library/react";
import { expectAccessible } from "alepha/testing/react";
import { describe, expect, it, vi } from "vitest";

import { PaneRail } from "../PaneRail.tsx";

describe("PaneRail", () => {
  it("is one button the whole strip: a click below the icon expands the pane", async () => {
    const onExpand = vi.fn();
    render(
      <PaneRail side="left" label="Show the tree" onExpand={onExpand}>
        <span data-testid="below">3</span>
      </PaneRail>,
    );

    const rail = screen.getByRole("button", { name: "Show the tree" });
    // axe: a pane rail (#Q3338).
    await expectAccessible();
    expect(rail.getAttribute("title")).toBe("Show the tree");
    // No inner button: the strip itself is the control.
    expect(rail.querySelector("button")).toBeNull();
    expect(rail.className).toContain("hover:bg-hover");

    fireEvent.click(screen.getByTestId("below"));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("puts the border on the side facing the content", () => {
    render(<PaneRail side="right" label="Show history" onExpand={() => {}} />);
    const rail = screen.getByRole("button", { name: "Show history" });
    expect(rail.className).toContain("border-l");
    expect(rail.className).not.toContain("border-r");
  });

  it("with a pane icon, keeps the open arrow at the strip's foot", () => {
    render(
      <PaneRail
        side="left"
        label="Show the log"
        onExpand={() => {}}
        icon={<svg data-testid="pane-icon" />}
        data-testid="rail"
      />,
    );
    const rail = screen.getByTestId("rail");
    const svgs = rail.querySelectorAll("svg");
    expect(svgs).toHaveLength(2);
    expect(svgs[0].getAttribute("data-testid")).toBe("pane-icon");
    expect(svgs[1].getAttribute("class")).toContain("mt-auto");
  });
});
