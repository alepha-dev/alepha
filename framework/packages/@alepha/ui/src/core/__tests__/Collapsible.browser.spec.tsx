import { fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "../Collapsible.tsx";

const Demo = (props: {
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  keepMounted?: boolean;
}) => (
  <Collapsible
    defaultOpen={props.defaultOpen}
    onOpenChange={props.onOpenChange}
  >
    <CollapsibleTrigger chevron>Try the demo</CollapsibleTrigger>
    <CollapsiblePanel keepMounted={props.keepMounted}>
      <button type="button">Sign in as a viewer</button>
    </CollapsiblePanel>
  </Collapsible>
);

describe("Collapsible", () => {
  it("is closed by default: the panel is not rendered, so it holds no focusable content", () => {
    render(<Demo />);
    const trigger = screen.getByRole("button", { name: "Try the demo" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Sign in as a viewer")).toBeNull();
  });

  it("opens and closes from the trigger, and reports each change", () => {
    const onOpenChange = vi.fn();
    render(<Demo onOpenChange={onOpenChange} />);
    const trigger = screen.getByRole("button", { name: "Try the demo" });

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.hasAttribute("data-panel-open")).toBe(true);
    const panel = screen
      .getByText("Sign in as a viewer")
      .closest("[data-slot=collapsible-panel]");
    expect(panel).not.toBeNull();
    expect(trigger.getAttribute("aria-controls")).toBe(panel?.id);
    expect(onOpenChange).toHaveBeenLastCalledWith(true, expect.anything());

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.hasAttribute("data-panel-open")).toBe(false);
    expect(onOpenChange).toHaveBeenLastCalledWith(false, expect.anything());
  });

  it("keeps a closed panel hidden in the DOM with keepMounted", () => {
    render(<Demo keepMounted />);
    const panel = document.querySelector("[data-slot=collapsible-panel]");
    expect(panel?.hasAttribute("hidden")).toBe(true);
  });

  it("draws the chevron only when asked", () => {
    const { container } = render(
      <Collapsible>
        <CollapsibleTrigger>Plain</CollapsibleTrigger>
      </Collapsible>,
    );
    expect(container.querySelector("[data-slot=collapsible-chevron]")).toBe(
      null,
    );
    render(<Demo />);
    expect(
      document.querySelector("[data-slot=collapsible-chevron]"),
    ).not.toBeNull();
  });

  it("renders on the server closed, or open at its natural height", () => {
    const closed = renderToString(<Demo />);
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).not.toContain("Sign in as a viewer");

    const open = renderToString(<Demo defaultOpen />);
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain("Sign in as a viewer");
    expect(open).toContain("--collapsible-panel-height:auto");
    expect(open).not.toContain('data-starting-style=""');
  });
});
