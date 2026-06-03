import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SIGIL_PETITION_SUBMITTED_MESSAGE } from "../../../shared/sigilMessages.ts";
import { SigilRoot } from "../SigilRoot.tsx";

describe("SigilRoot", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the feedback button", () => {
    render(<SigilRoot />);
    expect(screen.getByLabelText("Feedback")).toBeTruthy();
  });

  it("flashes a thank-you when the popup posts the submitted message", () => {
    render(<SigilRoot />);
    expect(screen.queryByText("Thank you!")).toBeNull();

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: SIGIL_PETITION_SUBMITTED_MESSAGE },
        }),
      );
    });

    expect(screen.getByText("Thank you!")).toBeTruthy();
  });

  it("ignores unrelated postMessage events", () => {
    render(<SigilRoot />);

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", { data: { type: "something-else" } }),
      );
    });

    expect(screen.queryByText("Thank you!")).toBeNull();
  });

  it("opens /sigil/request in a popup when the button is clicked", () => {
    const open = vi.fn(() => ({}) as Window);
    vi.stubGlobal("open", open);

    render(<SigilRoot />);
    fireEvent.click(screen.getByLabelText("Feedback"));

    expect(open).toHaveBeenCalledWith(
      "/sigil/request",
      "lore-petition",
      expect.stringMatching(
        /width=480,height=720,left=\d+(\.\d+)?,top=\d+(\.\d+)?/,
      ),
    );
  });
});
