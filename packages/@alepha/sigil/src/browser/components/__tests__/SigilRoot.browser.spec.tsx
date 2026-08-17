import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sigilClientAtom } from "../../../shared/sigilClientAtom.ts";
import { SIGIL_FEEDBACK_SUBMITTED_MESSAGE } from "../../../shared/sigilMessages.ts";
import { SigilRoot } from "../SigilRoot.tsx";

const renderRoot = async (config: {
  feedbackUrl?: string;
  excludedPaths?: string[];
}) => {
  const alepha = Alepha.create();
  await alepha.start();
  alepha.store.set(sigilClientAtom, {
    enabled: { views: true, errors: true, vitals: true },
    feedbackButtonExcludedPaths: config.excludedPaths ?? [],
    feedbackUrl: config.feedbackUrl,
    configAt: Date.now(),
  });
  render(
    <AlephaContext.Provider value={alepha}>
      <SigilRoot />
    </AlephaContext.Provider>,
  );
  return alepha;
};

describe("SigilRoot", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // Reset the SPA location so path-based tests stay independent.
    window.history.pushState({}, "", "/");
  });

  it("renders the feedback button when the sink hands out a feedback URL", async () => {
    await renderRoot({ feedbackUrl: "https://lore.alepha.dev/c/2/request" });
    expect(screen.getByLabelText("Feedback")).toBeTruthy();
  });

  it("does not render the button when there is no feedback URL", async () => {
    await renderRoot({});
    expect(screen.queryByLabelText("Feedback")).toBeNull();
  });

  it("hides the button on a path matching an excluded glob", async () => {
    window.history.pushState({}, "", "/c/2/request");
    await renderRoot({
      feedbackUrl: "https://lore.alepha.dev/c/2/request",
      excludedPaths: ["/c/*/request"],
    });
    expect(screen.queryByLabelText("Feedback")).toBeNull();
  });

  it("keeps the button on a non-excluded path", async () => {
    window.history.pushState({}, "", "/home");
    await renderRoot({
      feedbackUrl: "https://lore.alepha.dev/c/2/request",
      excludedPaths: ["/c/*/request"],
    });
    expect(screen.getByLabelText("Feedback")).toBeTruthy();
  });

  it("re-hides the button when navigating to an excluded path (SPA pushState)", async () => {
    window.history.pushState({}, "", "/home");
    await renderRoot({
      feedbackUrl: "https://lore.alepha.dev/c/2/request",
      excludedPaths: ["/c/*/request"],
    });
    expect(screen.getByLabelText("Feedback")).toBeTruthy();

    act(() => {
      window.history.pushState({}, "", "/c/2/request");
    });

    await waitFor(() => expect(screen.queryByLabelText("Feedback")).toBeNull());
  });

  it("flashes a thank-you when the popup posts the submitted message", async () => {
    await renderRoot({ feedbackUrl: "https://lore.alepha.dev/c/2/request" });
    expect(screen.queryByText("Thank you!")).toBeNull();

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: SIGIL_FEEDBACK_SUBMITTED_MESSAGE },
        }),
      );
    });

    expect(screen.getByText("Thank you!")).toBeTruthy();
  });

  it("ignores unrelated postMessage events", async () => {
    await renderRoot({ feedbackUrl: "https://lore.alepha.dev/c/2/request" });

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", { data: { type: "something-else" } }),
      );
    });

    expect(screen.queryByText("Thank you!")).toBeNull();
  });

  it("opens the feedback URL in a popup with captured page context when clicked", async () => {
    const open = vi.fn((..._args: unknown[]) => ({}) as Window);
    vi.stubGlobal("open", open);

    await renderRoot({ feedbackUrl: "https://lore.alepha.dev/c/2/request" });
    fireEvent.click(screen.getByLabelText("Feedback"));

    expect(open).toHaveBeenCalledWith(
      expect.stringMatching(
        /^https:\/\/lore\.alepha\.dev\/c\/2\/request\?.*\burl=/,
      ),
      "lore-feedback",
      expect.stringMatching(
        /width=480,height=720,left=\d+(\.\d+)?,top=\d+(\.\d+)?/,
      ),
    );

    const target = open.mock.calls[0][0] as string;
    const params = new URLSearchParams(target.split("?")[1]);
    expect(params.get("url")).toBe(window.location.href);
    expect(params.get("ua")).toBe(navigator.userAgent);
  });
});
