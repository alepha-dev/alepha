import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeAll, describe, expect, it } from "vitest";

import { Segmented, type SegmentedOption } from "../Segmented.tsx";

// The thumb measures itself with a ResizeObserver, which jsdom does not ship.
// Nothing here asserts the thumb, so a no-op is enough to let it mount.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const OPTIONS: SegmentedOption[] = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Bravo" },
  { value: "c", label: "Charlie" },
];

const Harness = (props: { options?: typeof OPTIONS; initial?: string }) => {
  const [value, setValue] = useState(props.initial ?? "a");
  return (
    <Segmented
      options={props.options ?? OPTIONS}
      value={value}
      onChange={setValue}
    />
  );
};

/**
 * A key press on the option that holds the selection, which is where focus is
 * after a click in a real browser. jsdom's `fireEvent.click` does not move
 * focus, so the target is named rather than read from `document.activeElement`.
 */
const press = (key: string) => {
  const target = screen
    .getAllByRole("radio")
    .find((r) => r.getAttribute("aria-checked") === "true");
  fireEvent.keyDown(target ?? document.body, { key });
};

const checked = () =>
  screen
    .getAllByRole("radio")
    .find((r) => r.getAttribute("aria-checked") === "true")?.textContent;

/**
 * `role="radiogroup"` promises arrow-key navigation: a radio group moves
 * between its options with the arrow keys, and moving the selection moves the
 * focus with it. Without it the role is a claim the control does not honour.
 */
describe("Segmented keyboard navigation", () => {
  it("moves the selection and the focus with the arrow keys", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("radio", { name: "Alpha" }));
    expect(checked()).toBe("Alpha");

    press("ArrowRight");
    expect(checked()).toBe("Bravo");
    expect(document.activeElement?.textContent).toBe("Bravo");

    press("ArrowLeft");
    expect(checked()).toBe("Alpha");
    expect(document.activeElement?.textContent).toBe("Alpha");
  });

  it("wraps at both ends, and Home / End jump to them", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("radio", { name: "Alpha" }));
    press("ArrowLeft");
    expect(checked()).toBe("Charlie");

    press("ArrowRight");
    expect(checked()).toBe("Alpha");

    press("End");
    expect(checked()).toBe("Charlie");

    press("Home");
    expect(checked()).toBe("Alpha");
  });

  it("steps over a disabled option rather than landing on it", () => {
    render(
      <Harness
        options={[
          { value: "a", label: "Alpha" },
          { value: "b", label: "Bravo", disabled: true },
          { value: "c", label: "Charlie" },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Alpha" }));
    press("ArrowRight");

    expect(checked()).toBe("Charlie");
  });

  it("leaves the selection alone when nothing else is selectable", () => {
    render(
      <Harness
        options={[
          { value: "a", label: "Alpha" },
          { value: "b", label: "Bravo", disabled: true },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Alpha" }));
    press("ArrowRight");

    expect(checked()).toBe("Alpha");
  });
});
