import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SIGIL_PETITION_SUBMITTED_MESSAGE } from "../../../shared/sigilMessages.ts";
import { SigilRoot } from "../SigilRoot.tsx";

const stubConfigFetch = (excludedPaths: string[]) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ excludedPaths }),
    })),
  );
};

describe("SigilRoot", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // Reset the SPA location so path-based tests stay independent.
    window.history.pushState({}, "", "/");
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

  it("hides the feedback button on a path matching an excluded glob", async () => {
    stubConfigFetch(["/c/*/request"]);
    window.history.pushState({}, "", "/c/2/request");

    render(<SigilRoot />);

    await waitFor(() => expect(screen.queryByLabelText("Feedback")).toBeNull());
  });

  it("keeps the feedback button on a non-excluded path", async () => {
    stubConfigFetch(["/c/*/request"]);
    window.history.pushState({}, "", "/home");

    render(<SigilRoot />);
    // Flush the config fetch + state update.
    await act(async () => {});

    expect(screen.getByLabelText("Feedback")).toBeTruthy();
  });

  it("re-hides the button when navigating to an excluded path (SPA pushState)", async () => {
    stubConfigFetch(["/c/*/request"]);
    window.history.pushState({}, "", "/home");

    render(<SigilRoot />);
    await act(async () => {});
    expect(screen.getByLabelText("Feedback")).toBeTruthy();

    act(() => {
      window.history.pushState({}, "", "/c/2/request");
    });

    await waitFor(() => expect(screen.queryByLabelText("Feedback")).toBeNull());
  });

  it("opens /sigil/request in a popup with captured page context when clicked", () => {
    const open = vi.fn((..._args: unknown[]) => ({}) as Window);
    vi.stubGlobal("open", open);

    render(<SigilRoot />);
    fireEvent.click(screen.getByLabelText("Feedback"));

    expect(open).toHaveBeenCalledWith(
      // Now carries the host page's context as a query string.
      expect.stringMatching(/^\/sigil\/request\?.*\burl=/),
      "lore-petition",
      expect.stringMatching(
        /width=480,height=720,left=\d+(\.\d+)?,top=\d+(\.\d+)?/,
      ),
    );

    // The popup target encodes the jsdom page URL + user agent.
    const target = open.mock.calls[0][0] as string;
    const params = new URLSearchParams(target.split("?")[1]);
    expect(params.get("url")).toBe(window.location.href);
    expect(params.get("ua")).toBe(navigator.userAgent);
  });
});
