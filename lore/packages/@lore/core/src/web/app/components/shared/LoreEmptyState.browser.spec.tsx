import { render, screen } from "@testing-library/react";
import { describe, it } from "vitest";

import LoreEmptyState from "./LoreEmptyState.tsx";

/**
 * The companion is decoration: an empty state says everything in its title
 * and its sentence, and jsdom, which has no canvas to draw her on, is the
 * proof that the screen stands without her.
 */
describe("LoreEmptyState", () => {
  it("says its title and description where there is no canvas", ({
    expect,
  }) => {
    const view = render(
      <LoreEmptyState
        mood="calm"
        title="All caught up"
        description="No feedback is waiting on you."
      />,
    );

    expect(screen.getByText("All caught up")).toBeTruthy();
    expect(screen.getByText("No feedback is waiting on you.")).toBeTruthy();
    const root = view.container.querySelector('[data-slot="lore-empty-state"]');
    expect(root?.getAttribute("data-mood")).toBe("calm");
  });

  it("hides the companion from assistive technology", ({ expect }) => {
    const view = render(<LoreEmptyState mood="asleep" title="Nothing yet" />);

    const canvas = view.container.querySelector("canvas");
    expect(canvas).toBeTruthy();
    expect(canvas?.closest("[aria-hidden]")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("renders its actions under the text", ({ expect }) => {
    render(
      <LoreEmptyState mood="glitch" title="Something went wrong">
        <button type="button">Reload</button>
      </LoreEmptyState>,
    );

    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
  });
});
