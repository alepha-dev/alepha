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
import { SIGIL_PETITION_SUBMITTED_MESSAGE } from "../../../shared/sigilMessages.ts";
import { SigilRoot } from "../SigilRoot.tsx";

const ALL = ["petition", "blights", "beacon", "vitals"];

const renderRoot = async (config: {
  features: string[];
  excludedPaths?: string[];
}) => {
  const alepha = Alepha.create();
  await alepha.start();
  alepha.store.set(sigilClientAtom, {
    features: config.features,
    excludedPaths: config.excludedPaths ?? [],
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

  it("renders the feedback button when petition is enabled", async () => {
    await renderRoot({ features: ALL });
    expect(screen.getByLabelText("Feedback")).toBeTruthy();
  });

  it("does not render the button when petition is disabled", async () => {
    await renderRoot({ features: ["blights", "beacon"] });
    expect(screen.queryByLabelText("Feedback")).toBeNull();
  });

  it("hides the button on a path matching an excluded glob", async () => {
    window.history.pushState({}, "", "/c/2/request");
    await renderRoot({ features: ALL, excludedPaths: ["/c/*/request"] });
    expect(screen.queryByLabelText("Feedback")).toBeNull();
  });

  it("keeps the button on a non-excluded path", async () => {
    window.history.pushState({}, "", "/home");
    await renderRoot({ features: ALL, excludedPaths: ["/c/*/request"] });
    expect(screen.getByLabelText("Feedback")).toBeTruthy();
  });

  it("re-hides the button when navigating to an excluded path (SPA pushState)", async () => {
    window.history.pushState({}, "", "/home");
    await renderRoot({ features: ALL, excludedPaths: ["/c/*/request"] });
    expect(screen.getByLabelText("Feedback")).toBeTruthy();

    act(() => {
      window.history.pushState({}, "", "/c/2/request");
    });

    await waitFor(() => expect(screen.queryByLabelText("Feedback")).toBeNull());
  });

  it("flashes a thank-you when the popup posts the submitted message", async () => {
    await renderRoot({ features: ALL });
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

  it("ignores unrelated postMessage events", async () => {
    await renderRoot({ features: ALL });

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", { data: { type: "something-else" } }),
      );
    });

    expect(screen.queryByText("Thank you!")).toBeNull();
  });

  it("opens /sigil/request in a popup with captured page context when clicked", async () => {
    const open = vi.fn((..._args: unknown[]) => ({}) as Window);
    vi.stubGlobal("open", open);

    await renderRoot({ features: ALL });
    fireEvent.click(screen.getByLabelText("Feedback"));

    expect(open).toHaveBeenCalledWith(
      expect.stringMatching(/^\/sigil\/request\?.*\burl=/),
      "lore-petition",
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
