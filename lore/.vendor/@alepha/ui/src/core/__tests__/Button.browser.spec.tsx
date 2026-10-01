import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "../Button.tsx";

/**
 * `loading` is the kit's own addition to the button, and every submit in the
 * kit leans on it to refuse a double click. What it promises is DOM: busy,
 * disabled, a spinner in place of the label, and the label kept in the layout
 * so the button does not change width.
 */
describe("Button loading", () => {
  it("is busy, disabled and shows a spinner while loading", () => {
    render(<Button loading>Save</Button>);
    const button = screen.getByRole("button");

    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.hasAttribute("data-loading")).toBe(true);
    expect(button.querySelector("svg.animate-spin")).not.toBeNull();
  });

  it("keeps the label in the layout, hidden, so the width holds", () => {
    render(<Button loading>Save</Button>);
    const label = screen.getByText("Save");

    expect(label.className).toContain("invisible");
  });

  it("does not run its click handler while loading", () => {
    let clicks = 0;
    render(
      <Button loading onClick={() => clicks++}>
        Save
      </Button>,
    );

    fireEvent.click(screen.getByRole("button"));
    expect(clicks).toBe(0);
  });

  it("carries none of it when not loading", () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole("button");

    expect(button.hasAttribute("aria-busy")).toBe(false);
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(button.hasAttribute("data-loading")).toBe(false);
    expect(button.querySelector("svg.animate-spin")).toBeNull();
    expect(screen.getByText("Save").className).not.toContain("invisible");
  });
});
