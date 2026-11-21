import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToggleChip } from "../analytics/ToggleChip.tsx";

/**
 * A locked chip refuses the press, never the release: a grain selected over
 * a short range and locked by a wider one is still in the query (sent as the
 * finest grain allowed), so the click that removes it has to work.
 */
describe("ToggleChip", () => {
  afterEach(() => {
    cleanup();
  });

  it("refuses to press a locked chip", () => {
    const onToggle = vi.fn();
    render(
      <ToggleChip pressed={false} locked onToggle={onToggle}>
        hour
      </ToggleChip>,
    );
    fireEvent.click(screen.getByRole("button", { name: /hour/ }));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("still unpresses a locked chip that is selected", () => {
    const onToggle = vi.fn();
    render(
      <ToggleChip pressed locked onToggle={onToggle}>
        hour
      </ToggleChip>,
    );
    fireEvent.click(screen.getByRole("button", { name: /hour/ }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
