import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  SIGIL_FEEDBACK_READY_MESSAGE,
  SIGIL_FEEDBACK_TRAIL_MESSAGE,
  type SigilFeedbackTrail,
} from "../../../shared/sigilFeedbackTrail.ts";
import { SigilFeedbackButton } from "../SigilFeedbackButton.tsx";

const TRAIL: SigilFeedbackTrail = {
  errors: [{ message: "boom", path: "/cart", at: 1 }],
  pages: [{ path: "/cart", at: 1 }],
  actions: [],
};

/**
 * The trail goes to the popup by `postMessage` (#Q4038), checked both
 * ways: only the popup it opened, from the feedback URL's origin, gets an
 * answer, and the answer is addressed to that origin.
 */
describe("SigilFeedbackButton trail", () => {
  const originalOpen = window.open;
  afterEach(() => {
    window.open = originalOpen;
  });

  const openPopup = () => {
    const posted: Array<{ data: unknown; origin: string }> = [];
    const popup = {
      postMessage: (data: unknown, origin: string) =>
        posted.push({ data, origin }),
    } as unknown as Window;
    window.open = (() => popup) as typeof window.open;
    render(
      <SigilFeedbackButton
        feedbackUrl="https://lore.example.test/acme/request"
        trail={() => TRAIL}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
    const ask = (source: unknown, origin: string) =>
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: SIGIL_FEEDBACK_READY_MESSAGE },
            origin,
            source: source as Window,
          }),
        );
      });
    return { popup, posted, ask };
  };

  it("answers its popup, from the feedback origin, addressed to that origin", () => {
    const { popup, posted, ask } = openPopup();

    ask(popup, "https://lore.example.test");

    expect(posted).toEqual([
      {
        data: { type: SIGIL_FEEDBACK_TRAIL_MESSAGE, trail: TRAIL },
        origin: "https://lore.example.test",
      },
    ]);
  });

  it("ignores another origin and another window", () => {
    const { popup, posted, ask } = openPopup();

    ask(popup, "https://evil.example.test");
    ask(window, "https://lore.example.test");

    expect(posted).toEqual([]);
  });
});
