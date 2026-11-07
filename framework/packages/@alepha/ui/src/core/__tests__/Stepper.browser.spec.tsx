import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Stepper, stepperStepState } from "../Stepper.tsx";

const STEPS = [
  { key: "a", label: "Identity" },
  { key: "b", label: "Address" },
  { key: "c", label: "Profile" },
];

describe("Stepper", () => {
  it("marks each step done, current or upcoming", () => {
    const { container } = render(<Stepper steps={STEPS} current={1} />);
    const states = [...container.querySelectorAll("li")].map((li) =>
      li.getAttribute("data-state"),
    );
    expect(states).toEqual(["done", "current", "upcoming"]);
    expect(
      screen.getByText("Address").closest("li")?.getAttribute("aria-current"),
    ).toBe("step");
  });

  it("lets only a done step be clicked", () => {
    const onStepClick = vi.fn();
    render(<Stepper steps={STEPS} current={1} onStepClick={onStepClick} />);
    fireEvent.click(screen.getByText("Profile"));
    fireEvent.click(screen.getByText("Address"));
    expect(onStepClick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Identity"));
    expect(onStepClick).toHaveBeenCalledWith(0);
  });

  it("derives a state from two indexes", () => {
    expect(stepperStepState(0, 2)).toBe("done");
    expect(stepperStepState(2, 2)).toBe("current");
    expect(stepperStepState(3, 2)).toBe("upcoming");
  });
});
