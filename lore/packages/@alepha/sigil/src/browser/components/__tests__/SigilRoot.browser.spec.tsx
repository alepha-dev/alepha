import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SigilRoot } from "../SigilRoot.tsx";

describe("SigilRoot", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the feedback button", () => {
    render(<SigilRoot />);
    expect(screen.getByLabelText("Feedback")).toBeTruthy();
  });

  it("opens /api/sigil/request in a popup when the button is clicked", () => {
    const open = vi.fn(() => ({}) as Window);
    vi.stubGlobal("open", open);

    render(<SigilRoot />);
    fireEvent.click(screen.getByLabelText("Feedback"));

    expect(open).toHaveBeenCalledWith(
      "/api/sigil/request",
      "lore-petition",
      "width=480,height=720",
    );
  });
});
